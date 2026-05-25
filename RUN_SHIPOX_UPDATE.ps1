param(
  [string]$From = "2026-01-01 00:00",
  [int]$LimitPages = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (!(Test-Path ".env.local")) {
  Write-Host "Нет .env.local. Создай файл и вставь Shipox доступы:" -ForegroundColor Yellow
  Write-Host "SHIPOX_USERNAME=..."
  Write-Host "SHIPOX_PASSWORD=..."
  Write-Host "SHIPOX_MARKETPLACE_ID=307345429"
  exit 1
}

$argsList = @("run", "etl:shipox:snapshot", "--", "--from", $From)
if ($LimitPages -gt 0) {
  $argsList += @("--limit-pages", [string]$LimitPages)
}

& npm @argsList
& npm run build

Write-Host ""
Write-Host "Готово. Snapshot обновлен: public/generatedSnapshot.json" -ForegroundColor Green
Write-Host "Для локальной проверки запусти: npm run dev" -ForegroundColor Green
