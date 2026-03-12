param(
  [string]$OutputDir = "release"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$RootDir = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $RootDir $OutputDir
$StageDir = Join-Path $ReleaseDir "ohmyqwen-offline-win64"
$PackageJson = Get-Content (Join-Path $RootDir "package.json") | ConvertFrom-Json
$Version = $PackageJson.version
$ArchiveName = "ohmyqwen-offline-win64-v$Version.zip"

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
  pnpm run build

  if (Test-Path $StageDir) {
    Remove-Item -Recurse -Force $StageDir
  }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

  foreach ($file in @("package.json", "pnpm-lock.yaml", "README.md")) {
    Copy-IfExists -Source $file -Destination (Join-Path $StageDir $file)
  }

  foreach ($dir in @("dist", "config")) {
    Copy-IfExists -Source $dir -Destination (Join-Path $StageDir $dir)
  }

  Copy-IfExists -Source "vendor/qmd/dist" -Destination (Join-Path $StageDir "vendor/qmd/dist")

  Push-Location $StageDir
  try {
    pnpm install --prod --frozen-lockfile
  }
  finally {
    Pop-Location
  }

  $ModelsDir = Join-Path $RootDir ".ohmyqwen/runtime/qmd/models"
  if (Test-Path $ModelsDir) {
    $TargetModelsRoot = Join-Path $StageDir ".ohmyqwen/runtime/qmd"
    New-Item -ItemType Directory -Force -Path $TargetModelsRoot | Out-Null
    Copy-Item -Recurse -Force $ModelsDir $TargetModelsRoot
  }

  if ($env:OHMYQWEN_NODE_RUNTIME_DIR -and (Test-Path $env:OHMYQWEN_NODE_RUNTIME_DIR)) {
    Copy-Item -Recurse -Force $env:OHMYQWEN_NODE_RUNTIME_DIR (Join-Path $StageDir "node-runtime")
  }

  $ServeCmd = @'
@echo off
setlocal
cd /d "%~dp0"
if "%OHMYQWEN_SERVER_TRACE%"=="" set OHMYQWEN_SERVER_TRACE=1
if "%OHMYQWEN_QMD_RUNTIME_ROOT%"=="" set OHMYQWEN_QMD_RUNTIME_ROOT=%~dp0.ohmyqwen\runtime\qmd
if "%OHMYQWEN_QMD_VENDOR_ROOT%"=="" set OHMYQWEN_QMD_VENDOR_ROOT=%~dp0vendor\qmd
if "%OHMYQWEN_QMD_MODELS_DIR%"=="" set OHMYQWEN_QMD_MODELS_DIR=%~dp0.ohmyqwen\runtime\qmd\models
echo [serve-ohmyqwen] OHMYQWEN_SERVER_TRACE=%OHMYQWEN_SERVER_TRACE%
echo [serve-ohmyqwen] OHMYQWEN_QMD_RUNTIME_ROOT=%OHMYQWEN_QMD_RUNTIME_ROOT%
echo [serve-ohmyqwen] OHMYQWEN_QMD_VENDOR_ROOT=%OHMYQWEN_QMD_VENDOR_ROOT%
echo [serve-ohmyqwen] OHMYQWEN_QMD_MODELS_DIR=%OHMYQWEN_QMD_MODELS_DIR%
if exist "%~dp0node-runtime\node.exe" (
  "%~dp0node-runtime\node.exe" "%~dp0dist\cli.js" serve
) else (
  node "%~dp0dist\cli.js" serve
)
'@
  Set-Content -Path (Join-Path $StageDir "serve-ohmyqwen.cmd") -Value $ServeCmd -Encoding ascii

  $ServePs1 = @'
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not $env:OHMYQWEN_SERVER_TRACE) { $env:OHMYQWEN_SERVER_TRACE = "1" }
if (-not $env:OHMYQWEN_QMD_RUNTIME_ROOT) { $env:OHMYQWEN_QMD_RUNTIME_ROOT = (Join-Path $root ".ohmyqwen/runtime/qmd") }
if (-not $env:OHMYQWEN_QMD_VENDOR_ROOT) { $env:OHMYQWEN_QMD_VENDOR_ROOT = (Join-Path $root "vendor/qmd") }
if (-not $env:OHMYQWEN_QMD_MODELS_DIR) { $env:OHMYQWEN_QMD_MODELS_DIR = (Join-Path $root ".ohmyqwen/runtime/qmd/models") }
Write-Host "[serve-ohmyqwen] OHMYQWEN_SERVER_TRACE=$env:OHMYQWEN_SERVER_TRACE"
Write-Host "[serve-ohmyqwen] OHMYQWEN_QMD_RUNTIME_ROOT=$env:OHMYQWEN_QMD_RUNTIME_ROOT"
Write-Host "[serve-ohmyqwen] OHMYQWEN_QMD_VENDOR_ROOT=$env:OHMYQWEN_QMD_VENDOR_ROOT"
Write-Host "[serve-ohmyqwen] OHMYQWEN_QMD_MODELS_DIR=$env:OHMYQWEN_QMD_MODELS_DIR"
$bundledNode = Join-Path $root "node-runtime/node.exe"
if (Test-Path $bundledNode) {
  & $bundledNode (Join-Path $root "dist/cli.js") serve
} else {
  node (Join-Path $root "dist/cli.js") serve
}
'@
  Set-Content -Path (Join-Path $StageDir "serve-ohmyqwen.ps1") -Value $ServePs1 -Encoding utf8

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

  Write-Host "Created offline bundle: $ArchivePath"
  Write-Host "Closed network run:"
  Write-Host "  Expand-Archive $ArchiveName -DestinationPath ."
  Write-Host "  cd ohmyqwen-offline-win64"
  if ($env:OHMYQWEN_NODE_RUNTIME_DIR -and (Test-Path $env:OHMYQWEN_NODE_RUNTIME_DIR)) {
    Write-Host "  .\\node-runtime\\node.exe dist\\cli.js serve"
  }
  else {
    Write-Host "  node dist/cli.js serve"
  }
}
finally {
  Pop-Location
}
