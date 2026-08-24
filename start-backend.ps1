# Levanta el backend FastAPI con el venv activado.
# Uso: .\start-backend.ps1

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
$Activate = Join-Path $Backend ".venv\Scripts\Activate.ps1"

Set-Location $Backend

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creando virtualenv en backend\.venv ..."
    python -m venv .venv
}

if (-not (Test-Path $Activate)) {
    throw "No se encontro Activate.ps1 en $Activate"
}

# Activar venv en esta sesion (misma logica que .venv\Scripts\Activate.ps1)
. $Activate

Write-Host "Instalando / actualizando dependencias..."
python -m pip install -q -r requirements.txt

if (-not (Test-Path (Join-Path $Backend ".env"))) {
    $template = Join-Path $Backend ".env.template"
    if (Test-Path $template) {
        Copy-Item $template (Join-Path $Backend ".env")
        Write-Host "Se creo backend\.env desde .env.template - configura DATABASE_URL antes de usar la API."
    }
}

Write-Host 'Backend en http://127.0.0.1:8000  (docs: /docs)'
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
