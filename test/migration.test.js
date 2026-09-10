import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_CLIENT_ROLES,
  clientsByDiscordId,
  planRoleAssignments,
  formatPlanSummary,
} from '../src/discord/migration.js';

function member(id, displayName, roleNames = [], extra = {}) {
  return { id, displayName, roleNames, bot: false, ...extra };
}

const KARAN = {
  'Client Name': 'Karan Shah',
  'Discord ID': '1532523139760783382',
  Brand: { id: 'sel1', name: 'Called Coaches' },
  'Package / Tier': { id: 'sel2', name: 'Momentum (Mid)' },
};

test('clientsByDiscordId indexes on the trimmed Discord ID and skips blanks', () => {
  const map = clientsByDiscordId([
    { fields: { 'Discord ID': '  123  ', 'Client Name': 'A' } },
    { fields: { 'Client Name': 'B' } },
    { fields: { 'Discord ID': '', 'Client Name': 'C' } },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get('123')['Client Name'], 'A');
});

test('a matched client gains their brand and tier role', () => {
  const plan = planRoleAssignments({
    members: [member('1532523139760783382', 'Karan Shah', ['Called Coaches'])],
    clients: clientsByDiscordId([{ fields: KARAN }]),
  });
  assert.equal(plan.clients.length, 1);
  assert.equal(plan.clients[0].tier, 'Momentum');
  // Already holds Called Coaches, so only the tier role is new.
  assert.deepEqual(plan.clients[0].add, ['Tier: Momentum']);
});

test('a client holding neither role gains both', () => {
  const plan = planRoleAssignments({
    members: [member('1532523139760783382', 'Karan Shah', [])],
    clients: clientsByDiscordId([{ fields: KARAN }]),
  });
  assert.deepEqual(plan.clients[0].add, ['Called Coaches', 'Tier: Momentum']);
});

// The ~57 people carrying Called Coaches with no Airtable record. Without
// this they would see only WELCOME the moment the restructure is applied.
test('a legacy client role with no Airtable record becomes a Veteran', () => {
  const plan = planRoleAssignments({
    members: [member('999', 'Old Client', ['Called Coaches'])],
    clients: new Map(),
  });
  assert.equal(plan.veterans.length, 1);
  assert.deepEqual(plan.veterans[0].add, ['Veteran']);
});

test('every legacy client role counts, not just Called Coaches', () => {
  const plan = planRoleAssignments({
    members: LEGACY_CLIENT_ROLES.map((role, i) => member(String(i), role, [role])),
    clients: new Map(),
  });
  assert.equal(plan.veterans.length, LEGACY_CLIENT_ROLES.length);
});

test('someone already a Veteran is listed but gains nothing', () => {
  const plan = planRoleAssignments({
    members: [member('999', 'Old Client', ['Called Coaches', 'Veteran'])],
    clients: new Map(),
  });
  assert.deepEqual(plan.veterans[0].add, []);
});

// Staff service clients, they aren't one. Eddie is both; he gets his tier
// role by hand rather than by a rule that would also catch Noah.
test('staff never get a tier role', () => {
  const plan = planRoleAssignments({
    members: [
      member('1', 'Noah', ['CSM', 'Called Coaches']),
      member('2', 'Eddie', ['Coach', 'Called Coaches']),
    ],
    clients: clientsByDiscordId([{ fields: { ...KARAN, 'Discord ID': '1' } }]),
  });
  assert.deepEqual(plan.clients, []);
  assert.deepEqual(plan.veterans, []);
  assert.deepEqual(
    plan.skipped.map((s) => s.reason),
    ['staff', 'staff']
  );
});

test('bots are skipped', () => {
  const plan = planRoleAssignments({
    members: [member('1', 'The Called Bot', ['Called Coaches'], { bot: true })],
    clients: new Map(),
  });
  assert.equal(plan.skipped[0].reason, 'bot');
});

// A client record with no package is a data gap. Guessing either way is
// wrong - Veteran would strip a paying client, a tier would invent a sale.
test('a client record with no package goes to a human rather than being guessed', () => {
  const plan = planRoleAssignments({
    members: [member('123', 'Half Filled', ['Called Coaches'])],
    clients: clientsByDiscordId([
      { fields: { 'Client Name': 'Half Filled', 'Discord ID': '123' } },
    ]),
  });
  assert.deepEqual(plan.clients, []);
  assert.deepEqual(plan.veterans, [], 'must not be silently demoted to Veteran');
  assert.match(plan.skipped[0].reason, /no Package \/ Tier/);
});

test('someone with no record and no client role is left alone', () => {
  const plan = planRoleAssignments({
    members: [member('1', 'Random Lurker', [])],
    clients: new Map(),
  });
  assert.match(plan.skipped[0].reason, /no Airtable record and no client role/);
});

test('the tier value resolves with the transitional parenthetical', () => {
  const plan = planRoleAssignments({
    members: [member('1', 'A', []), member('2', 'B', [])],
    clients: clientsByDiscordId([
      { fields: { 'Discord ID': '1', 'Package / Tier': 'Inner Circle (High)' } },
      { fields: { 'Discord ID': '2', 'Package / Tier': 'Foundations' } },
    ]),
  });
  assert.deepEqual(
    plan.clients.map((c) => c.tier),
    ['Inner Circle', 'Foundations']
  );
});

test('the summary reports who changes and who does not', () => {
  const plan = planRoleAssignments({
    members: [
      member('1532523139760783382', 'Karan Shah', []),
      member('999', 'Old Client', ['Called Coaches']),
      member('2', 'Noah', ['CSM']),
    ],
    clients: clientsByDiscordId([{ fields: KARAN }]),
  });
  const summary = formatPlanSummary(plan);
  assert.match(summary, /Karan Shah/);
  assert.match(summary, /Old Client/);
  assert.match(summary, /staff \(1\): Noah/);
  assert.match(summary, /2 member\(s\) would gain a role/);
});
