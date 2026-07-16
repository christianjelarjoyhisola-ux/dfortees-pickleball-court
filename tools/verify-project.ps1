[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  $checkFiles = @('booking-balance.js', 'brand-config.js', 'supabase-config.js', '_worker.js', 'create-accounts.js', 'setup-db.js')
  foreach ($file in $checkFiles) {
    & node --check $file
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $file" }
  }

  & node --test booking-balance.test.js
  if ($LASTEXITCODE -ne 0) { throw 'Booking-balance tests failed.' }

  if (Get-Command deno -ErrorAction SilentlyContinue) {
    & deno test --frozen --lock=deno.lock supabase/functions/_shared
    if ($LASTEXITCODE -ne 0) { throw 'Supabase shared-function tests failed.' }

    $functionFiles = Get-ChildItem -LiteralPath 'supabase\functions' -Directory |
      ForEach-Object { Join-Path $_.FullName 'index.ts' } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    & deno check --frozen --lock=deno.lock $functionFiles
    if ($LASTEXITCODE -ne 0) { throw 'Supabase Edge Function type checking failed.' }
  }

  $runtimeTargets = @('index.html', 'admin.html', 'login.html', 'host.html', 'brand-config.js', 'brand.css', 'supabase-config.js', '_worker.js', 'supabase')
  $legacyMatches = & rg -i -l 'korte|kortedos|korte-dos' @runtimeTargets 2>$null
  if ($legacyMatches) { throw "Legacy brand identifiers remain in runtime code: $($legacyMatches -join ', ')" }

  $configTargets = @('supabase-config.js', 'setup-db.js', 'create-accounts.js', 'SETUP_NEW_SUPABASE.sql', 'deploy-edge-functions.ps1', 'deploy-cloudflare-pages.ps1', 'supabase')
  $blockedPatterns = @('https://[a-z0-9-]+\.supabase\.co', 'eyJ[A-Za-z0-9._-]{40,}', 'ca-pub-1871576789265012')
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

  Write-Host "D'fortees verification passed. No live Korte or Supabase connection, unexpected Git remote, or missing runtime asset was detected."
} finally {
  Pop-Location
}
