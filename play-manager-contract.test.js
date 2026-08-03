const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = __dirname;
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const managerAssets = [
  'open-play-rating.js',
  'open-play-rotation.js',
  'play-manager-db.js',
  'play-manager.css',
  'play-manager.js',
  'player-live.css',
  'player-live.html',
  'player-live.js',
  'qrcode.min.js',
];

const managerMigrations = [
  '20260724090000_play_manager_round_conflict_guard.sql',
  '20260724150000_open_play_rotation_player_replace.sql',
  '20260724190000_open_play_rotation_parity.sql',
  '20260725100000_play_manager_player_replacement.sql',
  '20260725110000_play_manager_live_sharing.sql',
  '20260725120000_play_manager_live_share_lifecycle.sql',
  '20260725130000_play_manager_session_mutation_guard.sql',
  '20260725140000_play_manager_queue_wait_time.sql',
  '20260725150000_play_manager_match_winner_correction.sql',
  '20260725160000_play_manager_winner_reveal.sql',
  '20260725170000_play_manager_ready_courts.sql',
  '20260725180000_play_manager_player_skill_levels.sql',
  '20260728130000_open_play_performance_rating.sql',
  '20260729130000_open_play_competitive_head_to_head.sql',
  '20260729150000_open_play_production_ranking_modes.sql',
  '20260729170000_dfortees_two_game_ranking_qualification.sql',
];

test('the admin dashboard mounts only the dedicated Play Manager interface', () => {
  const admin = read('admin.html');
  assert.match(admin, /<div id="playManagerRoot"><\/div>/);
  assert.match(admin, /gamemgr:\(\)=>window\.PlayManager\?\.render\(\)/);
  assert.match(admin, /onclick="pmOpenFromReservations\(\)">Play Manager<\/button>/);
  assert.match(admin, /src="open-play-rotation\.js\?v=20260803-dfortees-play-manager-v1"/);
  assert.match(admin, /href="play-manager\.css\?v=20260803-dfortees-play-manager-v1"/);
  assert.match(admin, /src="play-manager-db\.js\?v=20260803-dfortees-play-manager-v1"/);
  assert.match(admin, /src="play-manager\.js\?v=20260803-dfortees-play-manager-v1"/);
  assert.match(read('play-manager.css'), /#sec-gamemgr > :not\(#playManagerRoot\)\s*\{\s*display: none !important;/);
});

test('the player live board keeps Dfortees branding and the secure runtime order', () => {
  const html = read('player-live.html');
  const runtimeAt = html.indexOf('src="/runtime-config.js"');
  const libraryAt = html.indexOf('src="supabase.min.js"');
  const adapterAt = html.indexOf('src="supabase-config.js');
  const bridgeAt = html.indexOf('src="single-tenant-api.js');
  const managerDbAt = html.indexOf('src="play-manager-db.js');
  const liveAt = html.indexOf('src="player-live.js');
  assert.ok(runtimeAt < libraryAt && libraryAt < adapterAt && adapterAt < bridgeAt);
  assert.ok(bridgeAt < managerDbAt && managerDbAt < liveAt);
  assert.match(html, /href="logonewnew\.png"/);
  assert.match(html, /brand-config\.js\?v=20260717-logo-v2/);
  assert.doesNotMatch(html + read('player-live.js') + read('play-manager.js'), /Korte DOS|korte-dos/i);
});

test('the manager adapter is isolated to gameplay data and guarded RPCs', () => {
  const adapter = read('play-manager-db.js');
  for (const method of [
    'createOpenPlayGameSession',
    'replaceOpenPlayGamePlayers',
    'addOpenPlayGameRound',
    'updateOpenPlayGameRoundIfCurrent',
    'replaceOpenPlayGameCourtPlayer',
    'correctOpenPlayGameMatchWinner',
    'syncOpenPlayGameQueueWaitTimes',
    'setOpenPlayGamePublicShare',
    'rotateOpenPlayGamePublicShare',
    'getPublicOpenPlayGameLiveBoard',
  ]) {
    assert.match(adapter, new RegExp(`async ${method}\\(`));
  }
  assert.match(adapter, /rpc\("update_open_play_game_round_if_current"/);
  assert.match(adapter, /rpc\("get_public_open_play_game_live_board"/);
  assert.doesNotMatch(adapter, /bookings|payment_sessions|receipt|remittance/i);
});

test('build and direct-deploy manifests include every Play Manager asset', () => {
  for (const manifest of ['tools/build-pages.js', 'tools/local-server.js', 'deploy-cloudflare-pages.ps1']) {
    const source = read(manifest);
    for (const asset of managerAssets) {
      assert.match(source, new RegExp(asset.replaceAll('.', '\\.') ), `${manifest} must include ${asset}`);
    }
  }
});

test('all forward-only Play Manager migrations are present in the fresh database bundle', () => {
  const bundleBuilder = read('tools/build-fresh-database-bundle.ps1');
  for (const migration of managerMigrations) {
    const relative = path.join('supabase', 'migrations', migration);
    assert.ok(fs.existsSync(path.join(root, relative)), `${migration} must exist`);
    assert.match(bundleBuilder, new RegExp(migration.replaceAll('.', '\\.')));
  }
  const migrationSql = managerMigrations
    .map(name => read(path.join('supabase', 'migrations', name)))
    .join('\n');
  assert.match(migrationSql, /create or replace function public\.update_open_play_game_round_if_current/i);
  assert.match(migrationSql, /create function public\.get_public_open_play_game_live_board/i);
  assert.match(migrationSql, /create or replace function public\.calculate_open_play_competitive_standings/i);
  assert.doesNotMatch(migrationSql, /Korte DOS|korte_dos/i);
});
