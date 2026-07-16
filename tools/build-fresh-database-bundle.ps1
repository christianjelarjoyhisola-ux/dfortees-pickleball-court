[CmdletBinding()]
param(
  [string]$SupabaseProjectUrl = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot '.generated'
$outputPath = Join-Path $outputDirectory 'dfortees-fresh-database.sql'

$sources = @(
  'SETUP_NEW_SUPABASE.sql',
  'supabase\migrations\20260713213000_accumulated_booking_fee_remittances.sql',
  'supabase\migrations\20260713233000_remittance_late_cycle_due_fix.sql',
  'supabase\migrations\20260713234500_remittance_audit_metrics.sql',
  'supabase\migrations\20260714090000_owner_void_delete_booking.sql',
  'supabase\migrations\20260716120000_host_balance_deadlines.sql'
)

$missing = $sources | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repoRoot $_) -PathType Leaf) }
if ($missing) {
  throw "Fresh-database bundle is incomplete. Missing: $($missing -join ', ')"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
$builder = [System.Text.StringBuilder]::new()
[void]$builder.AppendLine('-- D''FORTEES FRESH DATABASE BUNDLE')
[void]$builder.AppendLine('-- Generated locally. Apply only to a new, empty D''fortees Supabase project.')
[void]$builder.AppendLine('-- Review this file before execution. Never apply it to Korte or another live project.')
if ($SupabaseProjectUrl) {
  if ($SupabaseProjectUrl -notmatch '^https://[a-z0-9-]+\.supabase\.co$') {
    throw 'SupabaseProjectUrl must be the full URL of the new D''fortees Supabase project.'
  }
  [void]$builder.AppendLine("-- Target project URL: $SupabaseProjectUrl")
} else {
  [void]$builder.AppendLine('-- WARNING: Backend URL is intentionally disabled. Regenerate with -SupabaseProjectUrl before production use.')
}
[void]$builder.AppendLine()

foreach ($relativePath in $sources) {
  $fullPath = Join-Path $repoRoot $relativePath
  [void]$builder.AppendLine("-- ============================================================")
  [void]$builder.AppendLine("-- SOURCE: $relativePath")
  [void]$builder.AppendLine("-- ============================================================")
  $sql = [System.IO.File]::ReadAllText($fullPath, [System.Text.Encoding]::UTF8)
  if ($SupabaseProjectUrl) { $sql = $sql.Replace('https://dfortees-backend.invalid', $SupabaseProjectUrl.TrimEnd('/')) }
  [void]$builder.AppendLine($sql)
  [void]$builder.AppendLine()
}

[System.IO.File]::WriteAllText($outputPath, $builder.ToString(), $utf8)
Write-Host "Generated fresh D'fortees database bundle: $outputPath"
