$ErrorActionPreference = 'Stop'

$wixDir = Join-Path $env:LOCALAPPDATA 'BackupArc\wix314'

if (-not (Test-Path (Join-Path $wixDir 'candle.exe'))) {
  Write-Host 'Descargando WiX Toolset 3.14...'
  $zip = Join-Path $env:TEMP 'wix314-binaries.zip'
  Invoke-WebRequest -Uri 'https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $wixDir -Force
  Remove-Item $zip
}

$env:Path = "$wixDir;$env:Path"

node scripts/build-msi.mjs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}