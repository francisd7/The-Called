import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countedEventTypes, isCountedEventType } from '../src/lib/offerScope.ts';

/** Roughly the real account: a few sales links, a coaching one, a stray. */
const LINKS = [
  { uri: 'et/personal-branding', counted: true },
  { uri: 'et/strategy', counted: true },
  { uri: 'et/consultation', counted: true },
  { uri: 'et/discovery', counted: true },
  { uri: 'et/brotherhood', counted: true },
  // Nigel's calls with existing clients. Real calls, not leads.
  { uri: 'et/one-on-one', counted: false },
  { uri: 'et/strategy-old', counted: false },
];

test('only the ticked links count', () => {
  const counted = countedEventTypes(LINKS);
  assert.equal(counted.size, 5);
  assert.equal(isCountedEventType('et/personal-branding', counted), true);
  assert.equal(
    isCountedEventType('et/one-on-one', counted),
    false,
    'coaching calls with existing clients are not leads'
  );
});

test('a retired link still counts if it is ticked', () => {
  // Most of the booking history is on links nobody can book on any more.
  const counted = countedEventTypes([{ uri: 'et/retired', counted: true }]);
  assert.equal(isCountedEventType('et/retired', counted), true);
});

test('a booking with no event type is never counted', () => {
  const counted = countedEventTypes(LINKS);
  assert.equal(isCountedEventType(null, counted), false);
  assert.equal(isCountedEventType(undefined, counted), false);
  assert.equal(isCountedEventType('', counted), false);
});

test('nothing ticked means nothing counts, rather than everything', () => {
  // Reading an empty filter as "let it all through" is how the whole Calendly
  // account ended up in the lead tracker in the first place.
  const counted = countedEventTypes(LINKS.map((l) => ({ ...l, counted: false })));
  assert.equal(counted.size, 0);
  assert.equal(isCountedEventType('et/personal-branding', counted), false);
});
