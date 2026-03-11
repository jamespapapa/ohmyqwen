param(
  [string]$OutputDir = "release"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$RootDir = Split-Path -Parent $PSScriptRoot
$ConsoleDir = Join-Path $RootDir "console-next"
$ReleaseDir = Join-Path $RootDir $OutputDir
$StageDir = Join-Path $ReleaseDir "ohmyqwen-console-offline-win64"
$PackageJson = Get-Content (Join-Path $ConsoleDir "package.json") | ConvertFrom-Json
$Version = $PackageJson.version
$ArchiveName = "ohmyqwen-console-offline-win64-v$Version.zip"

function Copy-IfExists {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (Test-Path $Source) {
    $parent = Split-Path -Parent $Destination
    if ($parent) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Copy-Item -Recurse -Force $Source $Destination
  }
}

Push-Location $RootDir
try {
  pnpm --dir console-next build

  if (Test-Path $StageDir) {
    Remove-Item -Recurse -Force $StageDir
  }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

  Copy-IfExists -Source "console-next/.next/standalone/server.js" -Destination (Join-Path $StageDir "server.js")
  Copy-IfExists -Source "console-next/.next/standalone/package.json" -Destination (Join-Path $StageDir "package.json")
  Copy-IfExists -Source "console-next/.next/standalone/node_modules" -Destination (Join-Path $StageDir "node_modules")
  Copy-IfExists -Source "console-next/.next/standalone/.next" -Destination (Join-Path $StageDir ".next")
  Copy-IfExists -Source "console-next/.next/static" -Destination (Join-Path $StageDir ".next/static")
  Copy-IfExists -Source "console-next/public" -Destination (Join-Path $StageDir "public")
  Copy-IfExists -Source "console-next/README.md" -Destination (Join-Path $StageDir "README.md")

  if ($env:OHMYQWEN_NODE_RUNTIME_DIR -and (Test-Path $env:OHMYQWEN_NODE_RUNTIME_DIR)) {
    Copy-Item -Recurse -Force $env:OHMYQWEN_NODE_RUNTIME_DIR (Join-Path $StageDir "node-runtime")
  }

  $EnvExample = @'
BACKEND_BASE_URL=http://127.0.0.1:4311
PORT=3005
'@
  Set-Content -Path (Join-Path $StageDir ".env.example") -Value $EnvExample -Encoding ascii

  $ServeCmd = @'
@echo off
setlocal
if "%PORT%"=="" set PORT=3005
if "%BACKEND_BASE_URL%"=="" set BACKEND_BASE_URL=http://127.0.0.1:4311
if exist "%~dp0node-runtime\node.exe" (
  "%~dp0node-runtime\node.exe" "%~dp0server.js"
) else (
  node "%~dp0server.js"
)
'@
  Set-Content -Path (Join-Path $StageDir "serve-console.cmd") -Value $ServeCmd -Encoding ascii

  $ServePs1 = @'
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $env:PORT) { $env:PORT = "3005" }
if (-not $env:BACKEND_BASE_URL) { $env:BACKEND_BASE_URL = "http://127.0.0.1:4311" }
$bundledNode = Join-Path $root "node-runtime/node.exe"
if (Test-Path $bundledNode) {
  & $bundledNode (Join-Path $root "server.js")
} else {
  node (Join-Path $root "server.js")
}
'@
  Set-Content -Path (Join-Path $StageDir "serve-console.ps1") -Value $ServePs1 -Encoding utf8

  if (-not (Test-Path $ReleaseDir)) {
    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
  }
  $ArchivePath = Join-Path $ReleaseDir $ArchiveName
  if (Test-Path $ArchivePath) {
    Remove-Item -Force $ArchivePath
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $StageDir,
    $ArchivePath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  Write-Host "Created frontend offline bundle: $ArchivePath"
  Write-Host "Closed network run:"
  Write-Host "  Expand-Archive $ArchiveName -DestinationPath ."
  Write-Host "  cd ohmyqwen-console-offline-win64"
  if ($env:OHMYQWEN_NODE_RUNTIME_DIR -and (Test-Path $env:OHMYQWEN_NODE_RUNTIME_DIR)) {
    Write-Host "  .\\serve-console.cmd"
  }
  else {
    Write-Host "  node server.js"
  }
}
finally {
  Pop-Location
}
