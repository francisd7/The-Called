import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mapRecord, slug, type PostCallRecord } from '../src/lib/postCall.ts';
import { parseTeamDateTime, teamDateTimeInputValue } from '../src/lib/dates.ts';

const rec = (fields: PostCallRecord['fields']): PostCallRecord => ({ id: 'rec1', fields });

test('a closed call maps across whole', () => {
  const mapped = mapRecord(
    rec({
      fldoKwFzHYAUpXPre: 'Gavin',
      fldNz6hFtSdkT5sFU: '2026-09-10',
      flducCunxzZ08ZJxD: { name: 'Nigel' },
      fldN5bRlNhGA58J33: { name: 'Loui' },
      fld79p1lPISYwNRpi: { name: 'Closed' },
      fld8vpPRdacNoF4E5: { name: 'Momentum' },
      fldtETT2XDthDXhcb: { name: 'Splitit' },
      fldDfGJABBrqos4sQ: 5000,
      fldWQ2MDlZDH4HLRL: 10000,
      fld6E6FpFUUnEZBi9: 'https://fathom.video/share/abc',
    })
  );

  assert.ok(mapped);
  assert.equal(mapped.outcome, 'closed');
  assert.equal(mapped.closerName, 'Nigel');
  assert.equal(mapped.setterName, 'Loui');
  assert.equal(mapped.cashCollected, '5000.00');
  assert.equal(mapped.contractValue, '10000.00');
  assert.equal(mapped.fathomUrl, 'https://fathom.video/share/abc');
});

test('Airtable’s "No Close" placeholder is not a tier or a payment method', () => {
  const mapped = mapRecord(
    rec({
      fldoKwFzHYAUpXPre: 'Nobody',
      fld79p1lPISYwNRpi: { name: 'No Close' },
      fld8vpPRdacNoF4E5: { name: 'No Close' },
      fldtETT2XDthDXhcb: { name: 'No Close' },
    })
  );
  assert.ok(mapped);
  assert.equal(mapped.outcome, 'no_close');
  assert.equal(mapped.tier, null);
  assert.equal(mapped.paymentMethod, null);
});

test('the Fathom column only becomes a link when it holds one', () => {
  const note = mapRecord(rec({ fldoKwFzHYAUpXPre: 'A', fld6E6FpFUUnEZBi9: 'Will add once home' }));
  assert.equal(note?.fathomUrl, null);
  const link = mapRecord(rec({ fldoKwFzHYAUpXPre: 'A', fld6E6FpFUUnEZBi9: 'https://f.video/x' }));
  assert.equal(link?.fathomUrl, 'https://f.video/x');
});

test('a row with no name is not a report', () => {
  assert.equal(mapRecord(rec({ fld79p1lPISYwNRpi: { name: 'Closed' } })), null);
});

test('the fingerprint moves when an answer does, and only then', () => {
  const base = { fldoKwFzHYAUpXPre: 'Gavin', fldDfGJABBrqos4sQ: 5000 };
  const a = mapRecord(rec({ ...base }));
  const same = mapRecord(rec({ ...base }));
  const edited = mapRecord(rec({ ...base, fldDfGJABBrqos4sQ: 7500 }));

  assert.equal(a?.fingerprint, same?.fingerprint);
  assert.notEqual(a?.fingerprint, edited?.fingerprint);
});

test('a name becomes a usable stand-in key', () => {
  assert.equal(slug('Jacob De Nobriga'), 'jacob_de_nobriga');
  assert.equal(slug('  '), 'unknown');
});

test('a booking typed on the team clock comes back as the same wall time', () => {
  // Mid-August: daylight saving, so the team is four hours behind UTC.
  const summer = parseTeamDateTime('2026-08-12T14:30');
  assert.ok(summer);
  assert.equal(summer.toISOString(), '2026-08-12T18:30:00.000Z');
  assert.equal(teamDateTimeInputValue(summer), '2026-08-12T14:30');

  // Mid-January: standard time, five hours behind.
  const winter = parseTeamDateTime('2026-01-12T14:30');
  assert.ok(winter);
  assert.equal(winter.toISOString(), '2026-01-12T19:30:00.000Z');
  assert.equal(teamDateTimeInputValue(winter), '2026-01-12T14:30');
});

test('a booking time that makes no sense is refused rather than guessed', () => {
  assert.equal(parseTeamDateTime(''), null);
  assert.equal(parseTeamDateTime('tomorrow'), null);
  assert.equal(parseTeamDateTime('2026-13-45T99:99'), null);
});
