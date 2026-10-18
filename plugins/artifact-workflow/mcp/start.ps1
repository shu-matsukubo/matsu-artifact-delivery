param([string] $Entry)

$ErrorActionPreference = 'Stop'

if (-not [Environment]::Is64BitProcess) {
    throw 'artifact-workflow MCP supports Windows x64 only.'
}

$archive = Join-Path $PSScriptRoot 'node-win-x64.zip'
$metadataPath = Join-Path $PSScriptRoot 'node-runtime.json'
$runtimeMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$expectedNodeHash = [string] $runtimeMetadata.sourceSha256
if ($expectedNodeHash -notmatch '^[a-fA-F0-9]{64}$') {
    throw 'The bundled Node.js runtime metadata has an invalid sourceSha256.'
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$archiveStream = [System.IO.File]::OpenRead($archive)
try {
    $hash = [System.BitConverter]::ToString($sha256.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant()
} finally {
    $archiveStream.Dispose()
    $sha256.Dispose()
}
$runtimeRoot = $env:ARTIFACT_WORKFLOW_RUNTIME_DIR
if ([string]::IsNullOrWhiteSpace($runtimeRoot)) {
    if ([string]::IsNullOrWhiteSpace($env:PLUGIN_DATA)) {
        throw 'Set PLUGIN_DATA or ARTIFACT_WORKFLOW_RUNTIME_DIR to select a runtime directory.'
    }
    $runtimeRoot = Join-Path $env:PLUGIN_DATA 'runtime'
}
$runtime = Join-Path $runtimeRoot $hash
$node = Join-Path $runtime 'node.exe'
$runtimeMutex = New-Object System.Threading.Mutex($false, "Local\artifact-workflow-runtime-$hash")
$ownsRuntimeMutex = $false

function Test-NodeExecutable([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $fileStream = [System.IO.File]::OpenRead($Path)
    $fileHash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $actualHash = [System.BitConverter]::ToString($fileHash.ComputeHash($fileStream)).Replace('-', '')
    } finally {
        $fileStream.Dispose()
        $fileHash.Dispose()
    }
    return $actualHash.Equals($expectedNodeHash, [StringComparison]::OrdinalIgnoreCase)
}

try {
    try { $ownsRuntimeMutex = $runtimeMutex.WaitOne() } catch [System.Threading.AbandonedMutexException] {
        $ownsRuntimeMutex = $true
    }
    if (-not (Test-NodeExecutable $node)) {
        New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
        $temporary = Join-Path $runtimeRoot "$hash-$PID-$([guid]::NewGuid().ToString('N'))"
        $stale = Join-Path $runtimeRoot "$hash-invalid-$PID-$([guid]::NewGuid().ToString('N'))"
        try {
            [System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem') | Out-Null
            [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $temporary)
            if (-not (Test-NodeExecutable (Join-Path $temporary 'node.exe'))) {
                throw 'The bundled Node.js runtime archive does not contain the expected node.exe.'
            }
            if (Test-Path -LiteralPath $runtime) {
                if (Test-Path -LiteralPath $runtime -PathType Container) {
                    [System.IO.Directory]::Move($runtime, $stale)
                } else {
                    [System.IO.File]::Move($runtime, $stale)
                }
            }
            [System.IO.Directory]::Move($temporary, $runtime)
        } finally {
            if (Test-Path -LiteralPath $temporary) {
                Remove-Item -LiteralPath $temporary -Recurse -Force
            }
            if (Test-Path -LiteralPath $stale) {
                Remove-Item -LiteralPath $stale -Recurse -Force
            }
        }
    }
} finally {
    if ($ownsRuntimeMutex) { $runtimeMutex.ReleaseMutex() }
    $runtimeMutex.Dispose()
}

if ([string]::IsNullOrWhiteSpace($Entry)) {
    $Entry = Join-Path $PSScriptRoot 'task-memory.cjs'
}
if (-not (Test-Path -LiteralPath $Entry -PathType Leaf)) {
    throw "MCP entry point not found: $Entry"
}
$nativeSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace ArtifactWorkflow {
    public static class NativeProcess {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", EntryPoint = "GetStdHandle", SetLastError = true)]
        private static extern IntPtr GetStdHandle(int handle);
        [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(string applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, int creationFlags,
            IntPtr environment, string currentDirectory, ref StartupInfo startupInfo,
            out ProcessInformation processInformation);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out int exitCode);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public static int Run(string executable, string arguments) {
            var startupInfo = new StartupInfo();
            startupInfo.cb = Marshal.SizeOf(typeof(StartupInfo));
            startupInfo.dwFlags = 0x100;
            startupInfo.hStdInput = GetStdHandle(-10);
            startupInfo.hStdOutput = GetStdHandle(-11);
            startupInfo.hStdError = GetStdHandle(-12);
            ProcessInformation processInformation;
            var commandLine = new StringBuilder("\"" + executable + "\" " + arguments);
            if (!CreateProcess(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true, 0,
                IntPtr.Zero, null, ref startupInfo, out processInformation)) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            try {
                if (WaitForSingleObject(processInformation.hProcess, 0xffffffff) == 0xffffffff)
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                int exitCode;
                if (!GetExitCodeProcess(processInformation.hProcess, out exitCode))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return exitCode;
            } finally {
                CloseHandle(processInformation.hThread);
                CloseHandle(processInformation.hProcess);
            }
        }
    }
}
'@

# Process.Start は applicationName を省略して MAX_PATH 制限を受けるため、CreateProcessW に明示する。
Add-Type -TypeDefinition $nativeSource -ErrorAction Stop

$arguments = '"' + $Entry.Replace('"', '\"') + '"'
exit [ArtifactWorkflow.NativeProcess]::Run($node, $arguments)
