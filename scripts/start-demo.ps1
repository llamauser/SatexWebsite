# One-click start of the SATEX prototype on Windows (called by START-SATEX.bat; can be run again at any time).
# Needs: Docker Desktop, and (for the real local AI) Ollama. Node.js 22 and pnpm are installed if missing.
param(
  [int]$Port = 3000,
  [switch]$Rebuild,     # build the website again even if a build exists
  [switch]$NoBrowser,
  [switch]$NoPull       # do not download missing Ollama models (use the fake AI instead)
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Host.UI.RawUI.WindowTitle = "SATEX - start"

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Warn($text) { Write-Host "   ! $text" -ForegroundColor Yellow }
function Fail($text) {
  Write-Host ""
  Write-Host "PROBLEM: $text" -ForegroundColor Red
  Write-Host ""
  if (-not $NoBrowser) { Read-Host "Press Enter to close" }
  exit 1
}
function Quiet($commandLine) { cmd /c "$commandLine >nul 2>&1"; return $LASTEXITCODE }
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user;$env:APPDATA\npm;$env:LOCALAPPDATA\pnpm"
}
function Url-Up($url, $seconds = 5) {
  try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $seconds | Out-Null; return $true } catch { return $false }
}
function Read-EnvFile($path) {
  $map = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content $path) {
      if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $map[$Matches[1]] = $Matches[2].Trim().Trim('"') }
    }
  }
  return $map
}
Refresh-Path

Write-Host ""
Write-Host "  SATEX Commerce - prototype start" -ForegroundColor White
Write-Host "  The first start takes several minutes (downloads, build, fabric embeddings). Next starts take under a minute."

# ---------------------------------------------------------------- Docker
Step "Docker"
if (-not (Has "docker")) { Fail "Docker is not installed. Install Docker Desktop (docker.com), start it, then run START-SATEX.bat again." }
if ((Quiet "docker info") -ne 0) {
  $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $desktop) {
    Warn "Docker is not running: starting Docker Desktop (this can take a minute or two)..."
    Start-Process $desktop
  } else { Fail "Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then run START-SATEX.bat again." }
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep 4; if ((Quiet "docker info") -eq 0) { $ready = $true; break } }
  if (-not $ready) { Fail "Docker Desktop did not become ready in 6 minutes. Open it, check it is running, then run START-SATEX.bat again." }
}
Write-Host "   Docker is running."

# ---------------------------------------------------------------- Node.js and pnpm
Step "Node.js and pnpm"
function Node-Major { if (-not (Has "node")) { return 0 }; return [int](& node -p "process.versions.node.split('.')[0]") }
if ((Node-Major) -lt 22) {
  if (Has "winget") {
    Warn "Node.js 22 or newer is needed: installing it with winget..."
    & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  if ((Node-Major) -lt 22) { Fail "Node.js 22 or newer is needed. Install the LTS version from nodejs.org, then run START-SATEX.bat again." }
}
if (-not (Has "pnpm")) {
  Warn "Installing pnpm..."
  & npm install -g pnpm@9
  Refresh-Path
  if (-not (Has "pnpm")) { Fail "pnpm could not be installed. Open a new terminal and run: npm install -g pnpm@9" }
}
Write-Host ("   Node.js " + (& node --version) + ", pnpm " + (& pnpm --version))

# ---------------------------------------------------------------- packages
Step "Packages"
$stamp = "node_modules\.modules.yaml"
if (-not (Test-Path $stamp) -or ((Get-Item "pnpm-lock.yaml").LastWriteTime -gt (Get-Item $stamp).LastWriteTime)) {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed (is the computer online?). Run START-SATEX.bat again once it is fixed." }
} else { Write-Host "   Already installed." }

# ---------------------------------------------------------------- Ollama (local AI)
Step "Local AI (Ollama)"
$wanted = @("bge-m3", "qwen3:8b", "qwen2.5vl:7b")   # embeddings, text, photo recognition
$useOllama = $false
if (-not (Has "ollama")) {
  Warn "Ollama was not found: the website will use the built-in fake AI (the matcher answers, but not with real intelligence)."
} else {
  if (-not (Url-Up "http://127.0.0.1:11434")) {
    Write-Host "   Starting Ollama..."
    Start-Process -WindowStyle Hidden -FilePath "ollama" -ArgumentList "serve"
    for ($i = 0; $i -lt 30 -and -not (Url-Up "http://127.0.0.1:11434" 2); $i++) { Start-Sleep 2 }
  }
  if (-not (Url-Up "http://127.0.0.1:11434")) {
    Warn "Ollama does not answer: using the fake AI for now."
  } else {
    function Installed-Models { return @(& ollama list | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] }) }
    $have = Installed-Models
    foreach ($m in $wanted) {
      if (($have -notcontains $m) -and ($have -notcontains "$($m):latest") -and -not $NoPull) {
        Warn "Downloading the model $m (several GB, once)..."
        & ollama pull $m
      }
    }
    $have = Installed-Models
    $missing = @($wanted | Where-Object { ($have -notcontains $_) -and ($have -notcontains "$($_):latest") })
    if ($missing.Count -eq 0) { $useOllama = $true; Write-Host "   Ollama is ready with: $($wanted -join ', ')" }
    else { Warn "Missing Ollama models: $($missing -join ', '). Using the fake AI." }
  }
}

# ---------------------------------------------------------------- database
Step "Database (Supabase in Docker) - the first time this downloads several GB"
& pnpm db:start
if ($LASTEXITCODE -ne 0) { Fail "The database did not start. Check Docker Desktop is running and that ports 54321-54324 are free, then run START-SATEX.bat again." }

# ---------------------------------------------------------------- settings
Step "Settings (.env.local)"
$envPath = Join-Path $root ".env.local"
$current = Read-EnvFile $envPath
if (-not $current.ContainsKey("NEXT_PUBLIC_SUPABASE_URL") -or -not $current.ContainsKey("SUPABASE_SERVICE_ROLE_KEY")) {
  $lines = @(& node scripts/supabase-env.mjs)
  if ($LASTEXITCODE -ne 0 -or $lines.Count -lt 2) { Fail "Could not read the database addresses and keys. Run START-SATEX.bat again." }
  $lines += "NEXT_PUBLIC_SITE_URL=http://localhost:$Port"
  $lines += "CRON_SECRET=local-secret"
  $lines += "EMAIL_PROVIDER=log"
  if ($useOllama) {
    $lines += "AI_PROVIDER=ollama"; $lines += "EMBED_PROVIDER=ollama"
    $lines += "OLLAMA_BASE_URL=http://127.0.0.1:11434"
    $lines += "OLLAMA_CHAT_MODEL=qwen3:8b"; $lines += "OLLAMA_VISION_MODEL=qwen2.5vl:7b"; $lines += "EMBEDDING_MODEL=bge-m3"
  } else { $lines += "AI_PROVIDER=fake"; $lines += "EMBED_PROVIDER=fake" }
  [IO.File]::WriteAllText($envPath, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
  $current = Read-EnvFile $envPath
  Write-Host "   Created .env.local ($(if ($useOllama) { 'Ollama' } else { 'fake' }) AI)."
} else { Write-Host "   Using the existing .env.local." }
$secret = if ($current.ContainsKey("CRON_SECRET")) { $current["CRON_SECRET"] } else { "local-secret" }

# ---------------------------------------------------------------- demo data
Step "Demo data"
$seeded = $false
try {
  $rows = Invoke-RestMethod -Uri "$($current['NEXT_PUBLIC_SUPABASE_URL'])/rest/v1/fabrics?select=id&limit=1" -Headers @{ apikey = $current["NEXT_PUBLIC_SUPABASE_ANON_KEY"] } -TimeoutSec 30
  $seeded = (@($rows).Count -gt 0)
} catch { $seeded = $false }
if ($seeded) { Write-Host "   The database already has the demo data." }
else {
  Write-Host "   Filling the database with the demo fabrics, stock, accounts and quotes..."
  & pnpm db:seed
  if ($LASTEXITCODE -ne 0) { Fail "The demo data could not be created. Run START-SATEX.bat again; if it fails again, run STOP-SATEX.bat and then 'pnpm db:reset' in this folder." }
}

# ---------------------------------------------------------------- website
Step "Website"
if (Url-Up "http://localhost:$Port/fr" 5) {
  Write-Host "   The website already answers on port $Port."
} else {
  if ($Rebuild -or -not (Test-Path ".next\BUILD_ID")) {
    Write-Host "   Building the website (2 to 4 minutes, first time only)..."
    & pnpm build
    if ($LASTEXITCODE -ne 0) { Fail "The website build failed. Scroll up for the error." }
  }
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title SATEX website - leave this window open && pnpm exec next start -p $Port" -WorkingDirectory $root
  Write-Host "   Waiting for the website to answer..."
  $up = $false
  for ($i = 0; $i -lt 60; $i++) { if (Url-Up "http://localhost:$Port/fr" 20) { $up = $true; break }; Start-Sleep 3 }
  if (-not $up) { Fail "The website did not answer in time. Look at the 'SATEX website' window for the reason." }
}

# ---------------------------------------------------------------- background jobs (translations, AI search data, e-mails)
Step "Background jobs"
$jobScript = Join-Path $env:TEMP "satex-jobs-$Port.ps1"
$already = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*satex-jobs-$Port.ps1*" })
if ($already.Count -eq 0) {
  $body = @"
`$fails = 0
while (`$fails -lt 5) {
  try {
    Invoke-WebRequest -UseBasicParsing -Headers @{ Authorization = 'Bearer $secret' } -Uri 'http://localhost:$Port/api/jobs/run' -TimeoutSec 900 | Out-Null
    `$fails = 0
  } catch { `$fails++ }
  Start-Sleep 15
}
"@
  Set-Content -Path $jobScript -Value $body -Encoding ASCII
  Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $jobScript
  Write-Host "   Started (it stops by itself when the website is closed)."
} else { Write-Host "   Already running." }

# ---------------------------------------------------------------- done
$credentials = Join-Path $root ".seed-credentials.local.json"
Write-Host ""
Write-Host "  SATEX is running:  http://localhost:$Port" -ForegroundColor Green
Write-Host "  Accounts (admin@satex.test, sales1@satex.test, client1@satex.test ...): passwords in $credentials"
if ($useOllama) { Write-Host "  The AI search improves a few minutes after the first start, once every fabric has been embedded by Ollama." }
Write-Host "  To stop everything: STOP-SATEX.bat"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port" }
Write-Host ""
if (-not $NoBrowser) { Read-Host "Press Enter to close this window (the website keeps running)" }
