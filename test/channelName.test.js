import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyChannelName } from '../src/onboarding/channelName.js';

test('slugifies a plain name to lowercase-hyphenated', () => {
  assert.equal(slugifyChannelName('Jack Garcia'), 'jack-garcia');
});

test('strips accents', () => {
  assert.equal(slugifyChannelName('María Ñandú'), 'maria-nandu');
});

test('collapses non-alphanumeric runs and trims leading/trailing hyphens', () => {
  assert.equal(slugifyChannelName('  Jack   O\'Garcia!! '), 'jack-o-garcia');
});

test('falls back to a generic name when nothing usable remains', () => {
  assert.equal(slugifyChannelName('🔥🔥🔥'), 'new-member');
  assert.equal(slugifyChannelName(''), 'new-member');
  assert.equal(slugifyChannelName(undefined), 'new-member');
});
