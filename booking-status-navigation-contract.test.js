const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

test('booking status navigation is ordered for daily operations', () => {
  const labels = [
    'data-booking-status="all"',
    'data-booking-status="pending"',
    'data-booking-status="confirmed"',
    'data-booking-status="completed"',
    'data-booking-status="inactive"',
  ];
  let position = -1;
  for (const label of labels) {
    const next = admin.indexOf(label);
    assert.ok(next > position, `${label} should appear in the recommended order`);
    position = next;
  }
});

test('pending and inactive status groups include their related states', () => {
  assert.match(admin, /group === 'pending'\) return status === 'pending' \|\| status === 'verifying'/);
  assert.match(admin, /group === 'inactive'\) return status === 'cancelled' \|\| status === 'forfeited'/);
});

test('new and legacy placeholder holds stay out of booking navigation counts', () => {
  assert.match(admin, /b\?\.email === 'reserve@hold\.internal'/);
  assert.match(admin, /\^Reserving/);
  assert.match(admin, /bks=bks\.filter\(b=>!isPlaceholderHold\(b\)\)/);
});
