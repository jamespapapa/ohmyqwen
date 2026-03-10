param(
  [string]$OutputDir = "release"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$ReleaseDir = Join-Path $RootDir $OutputDir
$StageDir = Join-Path $ReleaseDir "ohmyqwen-offline-win64"
$PackageJson = Get-Content (Join-Path $RootDir "package.json") | ConvertFrom-Json
$Version = $PackageJson.version
$ArchiveName = "ohmyqwen-offline-win64-v$Version.zip"

Push-Location $RootDir
try {
  pnpm run build

  if (Test-Path $StageDir) {
    Remove-Item -Recurse -Force $StageDir
  }
  New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

  foreach ($entry in @("dist", "docs", "schemas", "samples", "src", "tests", "vendor", "node_modules")) {
    if (Test-Path $entry) {
      Copy-Item -Recurse -Force $entry $StageDir
    }
  }

  foreach ($file in @("package.json", "pnpm-lock.yaml", "tsconfig.json", "README.md", ".gitignore")) {
    if (Test-Path $file) {
      Copy-Item -Force $file $StageDir
    }
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

  if (-not (Test-Path $ReleaseDir)) {
    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
  }
  $ArchivePath = Join-Path $ReleaseDir $ArchiveName
  if (Test-Path $ArchivePath) {
    Remove-Item -Force $ArchivePath
  }
  Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $ArchivePath -Force

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
