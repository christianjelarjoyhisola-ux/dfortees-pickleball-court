[CmdletBinding()]
param(
  [switch]$AllowDemoMode
)

$ErrorActionPreference = "Stop"

function Read-EnvFile($Path) {
  $envMap = @{}
  if (-not (Test-Path $Path)) { return $envMap }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $envMap[$line.Substring(0, $idx)] = $line.Substring($idx + 1)
  }
  return $envMap
}

$envMap = Read-EnvFile ".env.local"

if ($envMap["DEPLOYMENT_BRAND"] -ne "dfortees") {
  throw "Set DEPLOYMENT_BRAND=dfortees in .env.local. Deployment stopped before contacting Cloudflare."
}

if (-not $env:CLOUDFLARE_API_TOKEN -and $envMap["CLOUDFLARE_API_TOKEN"]) {
  $env:CLOUDFLARE_API_TOKEN = $envMap["CLOUDFLARE_API_TOKEN"]
}

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw "Set CLOUDFLARE_API_TOKEN in the environment or .env.local."
}

$projectName = $envMap["CLOUDFLARE_PAGES_PROJECT"]
if (-not $projectName) {
  throw "Set CLOUDFLARE_PAGES_PROJECT to the new D'fortees Pages project. No default deployment target is allowed."
}
if ($projectName -match "korte") {
  throw "The Pages project name contains a blocked legacy identifier. Deployment stopped."
}
$branchName = if ($envMap["CLOUDFLARE_PAGES_BRANCH"]) { $envMap["CLOUDFLARE_PAGES_BRANCH"] } else { "main" }

$supabaseConfig = Get-Content -LiteralPath "supabase-config.js" -Raw
if ($supabaseConfig -match "NOT_CONFIGURED|dfortees-backend\.invalid") {
  if (-not $AllowDemoMode) {
    throw "The backend is disabled. Configure the new D'fortees Supabase project or rerun with -AllowDemoMode for a browser-only demo deployment."
  }
  Write-Warning "Deploying D'fortees in browser-only demo mode. Data will be local to each visitor's browser."
}

$publicFiles = @(
  "_headers",
  "_worker.js",
  "admin.html",
  "brand-config.js",
  "brand.css",
  "booking-balance.js",
  "chart.min.js",
  "dforteesspash.jpg",
  "host.html",
  "index.html",
  "login.html",
  "supabase-config.js",
  "supabase.min.js"
)

New-Item -ItemType Directory -Force ".cf-pages-deploy" | Out-Null
foreach ($file in $publicFiles) {
  if (Test-Path $file) {
    Copy-Item -LiteralPath $file -Destination ".cf-pages-deploy" -Force
  }
}

npx wrangler pages deploy ".cf-pages-deploy" --project-name $projectName --branch $branchName
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare Pages deploy failed with exit code $LASTEXITCODE."
}

Write-Host "Cloudflare Pages deployed."
