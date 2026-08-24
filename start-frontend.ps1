# Levanta el frontend Next.js.
# Uso: .\start-frontend.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Frontend = Join-Path $Root "frontend"

Set-Location $Frontend

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
    Write-Host "Instalando dependencias npm..."
    npm install
}

$EnvLocal = Join-Path $Frontend ".env.local"
$EnvExample = Join-Path $Frontend ".env.example"
if (-not (Test-Path $EnvLocal) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvLocal
    Write-Host "Se creo frontend\.env.local desde .env.example"
}

Write-Host "Frontend en http://127.0.0.1:3000"
npm run dev
