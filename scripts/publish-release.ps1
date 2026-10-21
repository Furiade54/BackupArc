$ErrorActionPreference = 'Stop'

# Ejecuta herramientas externas sin que PowerShell convierta su stderr
# en una excepción cuando se redirige (comportamiento de PowerShell 5).
# El código de salida queda en $script:ultimoCodigo.
function Invoke-Herramienta {
  param(
    [switch]$Silencioso,
    [Parameter(Mandatory = $true)][string]$Comando,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Argumentos
  )

  $anterior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'

  try {
    if ($Silencioso) {
      & $Comando @Argumentos *> $null
    } else {
      & $Comando @Argumentos | Out-Host
    }

    $script:ultimoCodigo = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $anterior
  }
}

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$paquete = Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json
$version = $paquete.version
$etiqueta = "v$version"

$carpetaMsi = Join-Path $raiz 'out-msi\make\wix\x64'
$msi = $null

if (Test-Path $carpetaMsi) {
  $msi = Get-ChildItem -Path $carpetaMsi -Filter '*.msi' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if (-not $msi) {
  Write-Error "No se encontró ningún MSI en $carpetaMsi. Ejecuta primero la compilación."
  exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error 'GitHub CLI (gh) no está instalado. Instálalo desde https://cli.github.com/.'
  exit 1
}

Invoke-Herramienta -Silencioso gh auth status

if ($script:ultimoCodigo -ne 0) {
  Write-Error 'GitHub CLI no está autenticado. Ejecuta "gh auth login" antes de publicar.'
  exit 1
}

$ErrorActionPreference = 'Continue'
$rama = git rev-parse --abbrev-ref HEAD 2>$null
$commitLocal = git rev-parse HEAD 2>$null
$commitRemoto = git rev-parse "origin/$rama" 2>$null
$ErrorActionPreference = 'Stop'

if ($commitLocal -and $commitRemoto -and $commitLocal -ne $commitRemoto) {
  Write-Warning "El commit local no coincide con origin/$rama. El release apuntará al código publicado en GitHub; haz push si quieres que coincida."
}

Write-Host "Publicando $($msi.Name) en el release $etiqueta..." -ForegroundColor Cyan

Invoke-Herramienta -Silencioso gh release view $etiqueta
$existeRelease = ($script:ultimoCodigo -eq 0)

if ($existeRelease) {
  Invoke-Herramienta gh release upload $etiqueta $msi.FullName --clobber

  if ($script:ultimoCodigo -ne 0) {
    Write-Error 'No se pudo subir el MSI al release existente.'
    exit 1
  }

  Write-Host "Release $etiqueta actualizado con el nuevo instalador." -ForegroundColor Green
} else {
  $fecha = (Get-Date).ToString('yyyy/MM/dd HH:mm')
  $notas = "Instalador MSI de BackupArc $version.`n`nGenerado el $fecha."

  Invoke-Herramienta gh release create $etiqueta $msi.FullName --title "BackupArc $version" --notes $notas --latest

  if ($script:ultimoCodigo -ne 0) {
    Write-Error 'No se pudo crear el release en GitHub.'
    exit 1
  }

  Write-Host "Release $etiqueta creado y publicado." -ForegroundColor Green
}

$ErrorActionPreference = 'Continue'
$urlRelease = gh release view $etiqueta --json url --jq '.url' 2>$null
$ErrorActionPreference = 'Stop'

if ($urlRelease) {
  Write-Host "Release: $urlRelease" -ForegroundColor Green
}
