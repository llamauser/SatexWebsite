# Stops the SATEX prototype started by START-SATEX.bat: the website, the background jobs and the database (its data is kept).
param([int]$Port = 3000)
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
$user = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machine;$user;$env:APPDATA\npm;$env:LOCALAPPDATA\pnpm"

Write-Host "Stopping the website on port $Port..."
foreach ($c in @(Get-NetTCPConnection -LocalPort $Port -State Listen)) { Stop-Process -Id $c.OwningProcess -Force }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*satex-jobs-$Port.ps1*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like "*SATEX website*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host "Stopping the database (the data is kept)..."
& pnpm db:stop
Write-Host ""
Write-Host "Stopped. Ollama and Docker Desktop are left running; close them yourself if you want."
Read-Host "Press Enter to close"
