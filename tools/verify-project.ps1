[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  $checkFiles = @('booking-balance.js', 'brand-config.js', 'supabase-config.js', 'single-tenant-api.js', 'open-play-rotation.js', 'open-play-rating.js', 'play-manager-db.js', 'play-manager.js', 'player-live.js', '_worker.js', 'tools/local-server.js', 'single-tenant-schema-contract.test.js', 'single-tenant-bridge-contract.test.js', 'payment-window-contract.test.js', 'brand-deployment-contract.test.js', 'settings-preservation-contract.test.js', 'play-manager-contract.test.js')
  foreach ($file in $checkFiles) {
    & node --check $file
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $file" }
  }

  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Node test suite failed.' }

  $denoAvailable = $false
  if (Get-Command deno -ErrorAction SilentlyContinue) {
    try {
      & deno --version 2>$null | Out-Null
      $denoAvailable = $LASTEXITCODE -eq 0
    } catch {
      Write-Warning "Deno is installed but cannot run in this environment; Edge Function type checking was skipped."
    }
  }
  if ($denoAvailable) {
    $functionFiles = Get-ChildItem -LiteralPath 'supabase\functions' -Directory |
      ForEach-Object { Join-Path $_.FullName 'index.ts' } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    & deno check $functionFiles
    if ($LASTEXITCODE -ne 0) { throw 'D''fortees Edge Function type checking failed.' }
  }

  $runtimeTargets = @('index.html', 'admin.html', 'login.html', 'host.html', 'player-live.html', 'brand-config.js', 'brand.css', 'supabase-config.js', 'single-tenant-api.js', 'open-play-rotation.js', 'open-play-rating.js', 'play-manager-db.js', 'play-manager.js', 'play-manager.css', 'player-live.js', 'player-live.css', '_worker.js', 'supabase/migrations/20260717130000_single_tenant_security.sql')
  $legacyMatches = & rg -i -l 'korte|kortedos|korte-dos' @runtimeTargets 2>$null
  if ($legacyMatches) { throw "Legacy brand identifiers remain in runtime code: $($legacyMatches -join ', ')" }

  $configTargets = @('supabase-config.js', 'single-tenant-api.js', 'play-manager-db.js', '_worker.js', 'deploy-edge-functions.ps1', 'deploy-cloudflare-pages.ps1', 'supabase/migrations/20260717130000_single_tenant_security.sql')
  $expectedPublicSupabaseUrl = 'https://ebykgvvjsuawawdheyil.supabase.co'
  foreach ($configTarget in $configTargets) {
    $configText = [System.IO.File]::ReadAllText((Join-Path $repoRoot $configTarget), [System.Text.Encoding]::UTF8)
    foreach ($urlMatch in [regex]::Matches($configText, 'https://[a-z0-9-]+\.supabase\.co')) {
      if ($urlMatch.Value -ne $expectedPublicSupabaseUrl) {
        throw "Unexpected Supabase project URL in $configTarget."
      }
    }
  }
  $blockedPatterns = @('eyJ[A-Za-z0-9._-]{40,}', 'ca-pub-1871576789265012')
  foreach ($pattern in $blockedPatterns) {
    $matches = & rg -i -l $pattern @configTargets 2>$null
    if ($matches) { throw "Blocked legacy or live configuration found for pattern '$pattern': $($matches -join ', ')" }
  }

  $missingAssets = [System.Collections.Generic.HashSet[string]]::new()
  foreach ($htmlFile in Get-ChildItem -File -Filter '*.html') {
    $html = [System.IO.File]::ReadAllText($htmlFile.FullName, [System.Text.Encoding]::UTF8)
    foreach ($match in [regex]::Matches($html, '(?:src|href)=["'']([^"''#?]+)')) {
      $reference = $match.Groups[1].Value
      if ($reference.Contains('${')) { continue }
      if ($reference -eq '/runtime-config.js') { continue }
      if ($reference -match '^(?:https?:|mailto:|tel:|data:|javascript:)') { continue }
      $candidate = Join-Path $repoRoot $reference
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { [void]$missingAssets.Add("$($htmlFile.Name): $reference") }
    }
  }
  foreach ($cssFile in Get-ChildItem -File -Filter '*.css') {
    $css = [System.IO.File]::ReadAllText($cssFile.FullName, [System.Text.Encoding]::UTF8)
    foreach ($match in [regex]::Matches($css, 'url\(["'']?([^"'')#?]+)')) {
      $reference = $match.Groups[1].Value.Trim()
      if ($reference -match '^(?:https?:|data:)') { continue }
      $candidate = Join-Path $repoRoot $reference
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { [void]$missingAssets.Add("$($cssFile.Name): $reference") }
    }
  }
  if ($missingAssets.Count -gt 0) { throw "Missing local assets: $([string]::Join(', ', $missingAssets))" }

  $expectedRemote = 'https://github.com/christianjelarjoyhisola-ux/dfortees-pickleball-court.git'
  $remotes = @(& git remote)
  foreach ($remote in $remotes) {
    $remoteUrls = @(& git remote get-url --all $remote)
    foreach ($remoteUrl in $remoteUrls) {
      if ($remote -ne 'origin' -or $remoteUrl -ne $expectedRemote) {
        throw "Unexpected Git remote detected: $remote -> $remoteUrl"
      }
    }
  }

  $secretPatterns = @('sb_secret_[A-Za-z0-9_-]+', 'service_role[^`"'']*[=:][^`"'']{20,}', 'SUPABASE_DB_PASSWORD\s*=\s*\S+')
  foreach ($pattern in $secretPatterns) {
    $secretMatches = & git grep -n -I -E $pattern -- . ':(exclude)package-lock.json' ':(exclude)tools/verify-project.ps1' 2>$null
    if ($secretMatches) { throw "A possible committed secret was detected for pattern '$pattern'." }
  }

  Write-Host "D'fortees verification passed. No Korte runtime reference, committed platform secret, unexpected Git remote, or missing runtime asset was detected."
} finally {
  Pop-Location
}
