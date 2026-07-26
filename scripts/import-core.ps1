param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TargetDir = Join-Path $ProjectRoot 'core\current'
$Target = Join-Path $TargetDir 'new-api.exe'

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
  throw "找不到文件：$Source"
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -LiteralPath $Source -Destination $Target -Force
Write-Host "已导入：$Target"
