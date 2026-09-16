# scripts/setup-sidecars.ps1
# Downloads and cryptographically verifies static FFmpeg and FFprobe sidecars for Windows.
#
# Usage:
#   pwsh scripts/setup-sidecars.ps1
#   pwsh scripts/setup-sidecars.ps1 -Force

param (
    [string]$Target = "x86_64-pc-windows-msvc",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$binDir = Join-Path $projectRoot "src-tauri\bin"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
}

$baseUrl = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"

$artifacts = @(
    @{
        name = "ffmpeg"
        file = "ffmpeg-win32-x64.gz"
        dest = "ffmpeg-x86_64-pc-windows-msvc.exe"
        sha  = "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77"
    },
    @{
        name = "ffprobe"
        file = "ffprobe-win32-x64.gz"
        dest = "ffprobe-x86_64-pc-windows-msvc.exe"
        sha  = "f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d"
    }
)

Write-Host "============================================================"
Write-Host "📦 Installing static sidecars for target: $Target"
Write-Host "============================================================"

foreach ($item in $artifacts) {
    $destPath = Join-Path $binDir $item.dest

    if (-not $Force -and (Test-Path $destPath)) {
        $existingSize = (Get-Item $destPath).Length
        if ($existingSize -gt 1000000) {
            Write-Host "✅ Sidecar already installed: $($item.dest) ($existingSize bytes). Pass -Force to re-download."
            continue
        }
    }

    $url = "$baseUrl/$($item.file)"
    $tempDir = [System.IO.Path]::GetTempPath()
    $gzPath = Join-Path $tempDir "$($item.file)"

    Write-Host "⬇️ Downloading $($item.name) from $url..."
    curl.exe -fsSL "$url" -o "$gzPath"

    Write-Host "🔒 Verifying SHA-256 digest for $($item.file)..."
    $actualSha = (Get-FileHash -Algorithm SHA256 -Path "$gzPath").Hash.ToLower()
    if ($actualSha -ne $item.sha) {
        Remove-Item -Force "$gzPath" -ErrorAction SilentlyContinue
        Write-Error "❌ SHA-256 mismatch for $($item.file)! Expected: $($item.sha), Got: $actualSha"
        exit 1
    }
    Write-Host "🔒 SHA-256 verified: $actualSha"

    Write-Host "📂 Decompressing to $destPath..."
    $inStream = [System.IO.File]::OpenRead($gzPath)
    $gzStream = [System.IO.Compression.GZipStream]::new($inStream, [System.IO.Compression.CompressionMode]::Decompress)
    $outStream = [System.IO.File]::Create($destPath)
    $gzStream.CopyTo($outStream)
    $outStream.Close()
    $gzStream.Close()
    $inStream.Close()
    Remove-Item -Force "$gzPath" -ErrorAction SilentlyContinue

    $installedSize = (Get-Item $destPath).Length
    Write-Host "✅ Successfully installed $($item.dest) ($installedSize bytes)"
}

Write-Host ""
Write-Host "🎉 Sidecars successfully configured!"
