import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS,
  getTierByKey,
  getTierByRoleName,
  getTierByAirtableValue,
  tierRank,
  tiersAtOrAbove,
  tierRoleNamesAtOrAbove,
  resolveTierFromRoleNames,
} from '../src/discord/tiers.js';

test('the ladder runs lowest to highest', () => {
  assert.deepEqual(
    TIERS.map((tier) => tier.key),
    ['the-called', 'foundations', 'momentum', 'inner-circle']
  );
  assert.ok(tierRank(getTierByKey('inner-circle')) > tierRank(getTierByKey('momentum')));
  assert.ok(tierRank(getTierByKey('momentum')) > tierRank(getTierByKey('foundations')));
});

test('only the bible-study tier has no private channel', () => {
  assert.equal(getTierByKey('the-called').hasPrivateChannel, false);
  assert.equal(getTierByKey('the-called').categoryName, null);
  for (const key of ['foundations', 'momentum', 'inner-circle']) {
    assert.equal(getTierByKey(key).hasPrivateChannel, true, key);
    assert.match(getTierByKey(key).categoryName, /^CLIENTS · /, key);
  }
});

// The business rule this whole restructure exists for: Andrew (CMO) and
// Nigel (Founder) service the top two tiers only, so they must not appear in
// a Foundations client's private channel.
test('Foundations is serviced by the CSM only; the top two tiers get the full team', () => {
  assert.deepEqual(getTierByKey('foundations').staffRoleNames, ['CSM', 'COO']);
  for (const key of ['momentum', 'inner-circle']) {
    assert.deepEqual(getTierByKey(key).staffRoleNames, ['CSM', 'CMO', 'Founder', 'COO'], key);
  }
});

test('lookup by Airtable value ignores case and surrounding whitespace', () => {
  assert.equal(getTierByAirtableValue('  momentum  ').key, 'momentum');
  assert.equal(getTierByAirtableValue('Inner Circle').key, 'inner-circle');
  assert.equal(getTierByAirtableValue('Entry'), null, 'the pre-rename value should not resolve');
  assert.equal(getTierByAirtableValue(''), null);
  assert.equal(getTierByAirtableValue(undefined), null);
});

test('lookup by role name', () => {
  assert.equal(getTierByRoleName('Tier: Momentum').key, 'momentum');
  assert.equal(getTierByRoleName('Momentum'), null, 'the bare name is not the role name');
});

test('tiersAtOrAbove covers "Foundations and up" and "Momentum and up"', () => {
  assert.deepEqual(
    tiersAtOrAbove('foundations').map((tier) => tier.key),
    ['foundations', 'momentum', 'inner-circle']
  );
  assert.deepEqual(tierRoleNamesAtOrAbove('momentum'), ['Tier: Momentum', 'Tier: Inner Circle']);
  assert.deepEqual(tiersAtOrAbove('nope'), []);
});

test('resolveTierFromRoleNames picks the highest when a member briefly holds two', () => {
  // Adding the new role before removing the old one is the normal way an
  // upsell gets clicked; that moment must resolve forward, not backward.
  assert.equal(
    resolveTierFromRoleNames(['Tier: Foundations', 'Tier: Momentum']).key,
    'momentum'
  );
  assert.equal(resolveTierFromRoleNames(['Called Coaches', 'Tier: Foundations']).key, 'foundations');
  assert.equal(resolveTierFromRoleNames(['Called Coaches']), null);
  assert.equal(resolveTierFromRoleNames([]), null);
});

// The Airtable options keep the old name in a parenthetical while the team
// gets used to the new ones. Reads must survive both that and a later
// cleanup, or every lookup would silently start returning null — which reads
// as "this client has no tier" rather than as an error.
test('Airtable values resolve with or without the transitional parenthetical', () => {
  assert.equal(getTierByAirtableValue('Momentum (Mid)').key, 'momentum');
  assert.equal(getTierByAirtableValue('Momentum').key, 'momentum');
  assert.equal(getTierByAirtableValue('Foundations (Entry)').key, 'foundations');
  assert.equal(getTierByAirtableValue('Inner Circle (High)').key, 'inner-circle');
  assert.equal(
    getTierByAirtableValue('The Called (Bible Study & Warrior Huddles)').key,
    'the-called'
  );
  assert.equal(getTierByAirtableValue('  inner circle (high)  ').key, 'inner-circle');
});

test('a value that is only a parenthetical resolves to nothing', () => {
  assert.equal(getTierByAirtableValue('(Mid)'), null);
  assert.equal(getTierByAirtableValue('Entry'), null);
});

// Writes go back as the exact select option name — Airtable rejects a value
// that isn't already an option, so these four strings are coupled to the
// base and a rename there means updating them here.
test('every tier writes back a value that matches its own name', () => {
  for (const tier of TIERS) {
    assert.equal(
      getTierByAirtableValue(tier.airtableValue).key,
      tier.key,
      `${tier.name} must round-trip`
    );
  }
});
