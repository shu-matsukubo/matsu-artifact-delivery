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

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $temporary = Join-Path $runtimeRoot "$hash-$PID-$([guid]::NewGuid().ToString('N'))"
    try {
        [System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem') | Out-Null
        [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $temporary)
        if (-not (Test-Path -LiteralPath (Join-Path $temporary 'node.exe') -PathType Leaf)) {
            throw 'The bundled Node.js runtime archive does not contain node.exe.'
        }
        try {
            [System.IO.Directory]::Move($temporary, $runtime)
        } catch {
            # Multiple Plugin processes may extract the same runtime at once.
            if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw }
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Recurse -Force
        }
    }
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
