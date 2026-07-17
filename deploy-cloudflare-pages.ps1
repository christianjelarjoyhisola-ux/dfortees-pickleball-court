[CmdletBinding()]
param(
  [switch]$AllowDemoMode,
  [switch]$AllowDevelopmentBackend
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

$runtimeUrl = [string]$envMap["PB_SUPABASE_URL"]
$runtimeKey = [string]$envMap["PB_SUPABASE_PUBLISHABLE_KEY"]
$backendConfigured = $runtimeUrl -match '^https://[a-z0-9]+\.supabase\.co$' -and
  $runtimeKey -match '^sb_publishable_'

if (-not $backendConfigured) {
  if (-not $AllowDemoMode) {
    throw "Set PB_SUPABASE_URL and PB_SUPABASE_PUBLISHABLE_KEY in .env.local, or use -AllowDemoMode."
  }
  Write-Warning "Deploying D'fortees in browser-only demo mode. Data will be local to each visitor's browser."
} elseif ($runtimeUrl -match "ebykgvvjsuawawdheyil" -and -not $AllowDevelopmentBackend) {
  throw "The backend is the Free development project. Pass -AllowDevelopmentBackend only for an intentional non-production preview."
} elseif ($runtimeUrl -match 'korte') {
  throw "A blocked legacy Supabase URL was detected. Deployment stopped."
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
  "logonewnew.png",
  "single-tenant-api.js",
  "supabase-config.js",
  "supabase.min.js"
)

$repoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$deployDirectory = Join-Path $repoRoot ".cf-pages-deploy"
$deployParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $deployDirectory))
if ($deployParent -ne $repoRoot -or (Split-Path -Leaf $deployDirectory) -ne ".cf-pages-deploy") {
  throw "Refusing to clean an unexpected Cloudflare deployment directory: $deployDirectory"
}
if (Test-Path -LiteralPath $deployDirectory) {
  $existingDeployDirectory = Get-Item -LiteralPath $deployDirectory -Force
  if (-not $existingDeployDirectory.PSIsContainer -or
      ($existingDeployDirectory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw "Refusing to clean a non-directory or linked Cloudflare deployment path: $deployDirectory"
  }
  Remove-Item -LiteralPath $deployDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $deployDirectory | Out-Null
foreach ($file in $publicFiles) {
  $source = Join-Path $repoRoot $file
  if (Test-Path -LiteralPath $source -PathType Leaf) {
    Copy-Item -LiteralPath $source -Destination $deployDirectory -Force
  } else {
    throw "Required public deployment file is missing: $file"
  }
}

if ($backendConfigured) {
  $runtimeSecrets = @{
    "PB_SUPABASE_URL" = $runtimeUrl
    "PB_SUPABASE_PUBLISHABLE_KEY" = $runtimeKey
  }
  foreach ($name in $runtimeSecrets.Keys) {
    $runtimeSecrets[$name] | npx wrangler pages secret put $name --project-name $projectName
    if ($LASTEXITCODE -ne 0) { throw "Could not configure the Cloudflare runtime value $name." }
  }
}

npx wrangler pages deploy $deployDirectory --project-name $projectName --branch $branchName
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare Pages deploy failed with exit code $LASTEXITCODE."
}

Write-Host "Cloudflare Pages deployed."
