param([string] $Entry)

$ErrorActionPreference = 'Stop'

if (-not [Environment]::Is64BitProcess) {
    throw 'artifact-workflow MCP supports Windows x64 only.'
}

$archive = Join-Path $PSScriptRoot 'node-win-x64.zip'
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
    $runtimeRoot = Join-Path $env:LOCALAPPDATA 'artifact-workflow\runtime'
}
$runtime = Join-Path $runtimeRoot $hash
$node = Join-Path $runtime 'node.exe'
$runtimeMutex = New-Object System.Threading.Mutex($false, "Local\artifact-workflow-runtime-$hash")
$ownsRuntimeMutex = $false

try {
    try { $ownsRuntimeMutex = $runtimeMutex.WaitOne() } catch [System.Threading.AbandonedMutexException] {
        $ownsRuntimeMutex = $true
    }
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
        New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
        $temporary = Join-Path $runtimeRoot "$hash-$PID-$([guid]::NewGuid().ToString('N'))"
        $stale = Join-Path $runtimeRoot "$hash-invalid-$PID-$([guid]::NewGuid().ToString('N'))"
        try {
            [System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem') | Out-Null
            [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $temporary)
            if (-not (Test-Path -LiteralPath (Join-Path $temporary 'node.exe') -PathType Leaf)) {
                throw 'The bundled Node.js runtime archive does not contain node.exe.'
            }
            if (Test-Path -LiteralPath $runtime -PathType Container) {
                [System.IO.Directory]::Move($runtime, $stale)
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
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node
$startInfo.Arguments = '"' + $Entry.Replace('"', '\"') + '"'
$startInfo.UseShellExecute = $false
$process = [System.Diagnostics.Process]::Start($startInfo)
$process.WaitForExit()
exit $process.ExitCode
