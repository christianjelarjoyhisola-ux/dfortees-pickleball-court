[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $repoRoot ".env.local"

function Read-EnvFile($Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $values }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $separator = $line.IndexOf("=")
    if ($separator -lt 1) { return }
    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
    $values[$name] = $value
  }
  return $values
}

function Resolve-Value($Name, $Values) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value -and $Values.ContainsKey($Name)) { $value = $Values[$Name] }
  return [string]$value
}

$values = Read-EnvFile $envFile
$approval = Resolve-Value "PLATFORM_EDGE_DEPLOYMENT_APPROVED" $values
if ($approval -ne "court-booking-platform-dev") {
  throw "Set PLATFORM_EDGE_DEPLOYMENT_APPROVED=court-booking-platform-dev. Legacy functions are intentionally blocked."
}

$projectRef = Resolve-Value "SUPABASE_PROJECT_REF" $values
if ($projectRef -ne "ekldjeskfddtzznamkxh") {
  throw "This development deploy script only targets the isolated court-booking-platform-dev project."
}

$accessToken = Resolve-Value "SUPABASE_ACCESS_TOKEN" $values
if (-not $accessToken) { throw "Set SUPABASE_ACCESS_TOKEN in the environment or .env.local." }
$env:SUPABASE_ACCESS_TOKEN = $accessToken

$npx = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
if (-not $npx) { $npx = Get-Command "npx" -ErrorAction SilentlyContinue }
if (-not $npx) { throw "Node.js/npx is required to deploy the platform functions." }

$platformRoot = Join-Path $repoRoot "platform"
$functions = @("manage-member", "create-file-upload")

Push-Location $platformRoot
try {
  foreach ($functionName in $functions) {
    & $npx.Source supabase functions deploy $functionName --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) {
      throw "Supabase function deployment failed for $functionName."
    }
  }
} finally {
  Pop-Location
}

Write-Host "Deployed only the tenant-aware Court Booking Platform functions."
