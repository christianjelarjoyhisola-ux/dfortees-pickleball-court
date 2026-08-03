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
  'supabase\migrations\20260716120000_host_balance_deadlines.sql',
  'supabase\migrations\20260717130000_single_tenant_security.sql',
  'supabase\migrations\20260717143000_receipt_verification_rate_limit.sql',
  'supabase\migrations\20260718090000_atomic_booking_cancellation.sql',
  'supabase\migrations\20260718094000_fix_guest_cancellation_guard.sql',
  'supabase\migrations\20260718100000_discard_unfinished_guest_holds.sql',
  'supabase\migrations\20260717214500_restore_service_role_privileges.sql',
  'supabase\migrations\20260724090000_play_manager_round_conflict_guard.sql',
  'supabase\migrations\20260724150000_open_play_rotation_player_replace.sql',
  'supabase\migrations\20260724190000_open_play_rotation_parity.sql',
  'supabase\migrations\20260725100000_play_manager_player_replacement.sql',
  'supabase\migrations\20260725110000_play_manager_live_sharing.sql',
  'supabase\migrations\20260725120000_play_manager_live_share_lifecycle.sql',
  'supabase\migrations\20260725130000_play_manager_session_mutation_guard.sql',
  'supabase\migrations\20260725140000_play_manager_queue_wait_time.sql',
  'supabase\migrations\20260725150000_play_manager_match_winner_correction.sql',
  'supabase\migrations\20260725160000_play_manager_winner_reveal.sql',
  'supabase\migrations\20260725170000_play_manager_ready_courts.sql',
  'supabase\migrations\20260725180000_play_manager_player_skill_levels.sql',
  'supabase\migrations\20260728130000_open_play_performance_rating.sql',
  'supabase\migrations\20260729130000_open_play_competitive_head_to_head.sql',
  'supabase\migrations\20260729150000_open_play_production_ranking_modes.sql',
  'supabase\migrations\20260729170000_dfortees_two_game_ranking_qualification.sql'
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
[void]$builder.AppendLine('-- Historical pricing/fee repair migrations are intentionally excluded because live admin settings are authoritative.')
if ($SupabaseProjectUrl) {
  if ($SupabaseProjectUrl -notmatch '^https://[a-z0-9-]+\.supabase\.co$') {
    throw 'SupabaseProjectUrl must be the full URL of the new D''fortees Supabase project.'
  }
  [void]$builder.AppendLine("-- Target project URL: $SupabaseProjectUrl")
} else {
  [void]$builder.AppendLine('-- WARNING: Backend URL is intentionally disabled. Regenerate with -SupabaseProjectUrl before production use.')
}
[void]$builder.AppendLine()
[void]$builder.AppendLine(@'
-- Executable fresh-project guard. This must run before any schema or seed SQL.
do $dfortees_fresh_project_guard$
begin
  if to_regclass('public.settings') is not null
     or to_regclass('public.courts') is not null
     or to_regclass('public.bookings') is not null
     or to_regclass('public.accounts') is not null then
    raise exception using
      errcode = '55000',
      message = 'REFUSED: D''fortees fresh database SQL cannot run on an existing application database.';
  end if;
end;
$dfortees_fresh_project_guard$;
'@)
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
