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
$approval = Resolve-Value "DFORTEES_EDGE_DEPLOYMENT_APPROVED" $values
if ($approval -ne "I_UNDERSTAND") {
  throw "Set DFORTEES_EDGE_DEPLOYMENT_APPROVED=I_UNDERSTAND before deploying reviewed D'fortees functions."
}

$projectRef = Resolve-Value "SUPABASE_PROJECT_REF" $values
if ($projectRef -ne "ebykgvvjsuawawdheyil") {
  throw "This script only targets the isolated dfortees-booking Supabase project."
}

$accessToken = Resolve-Value "SUPABASE_ACCESS_TOKEN" $values
if (-not $accessToken) { throw "Set SUPABASE_ACCESS_TOKEN in the environment or .env.local." }
$env:SUPABASE_ACCESS_TOKEN = $accessToken

$npx = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
if (-not $npx) { $npx = Get-Command "npx" -ErrorAction SilentlyContinue }
if (-not $npx) { throw "Node.js/npx is required to deploy the platform functions." }

$functions = @(
  "create-payment-session",
  "verify-gcash-receipt",
  "send-confirmation-email",
  "send-reschedule-email",
  "send-telegram-notification",
  "process-host-balance-deadlines"
)

Push-Location $repoRoot
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

Write-Host "Deployed only the reviewed D'fortees single-tenant Edge Functions."
