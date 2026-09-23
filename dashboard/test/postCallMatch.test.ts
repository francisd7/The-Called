import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { firstName, nameCouldMatch, pickAutoMatch } from '../src/lib/postCallMatch.ts';

const day = new Date('2026-09-22T17:00:00Z');
const lead = (over: Partial<Parameters<typeof nameCouldMatch>[0]> = {}) => ({
  id: 'lead-1', name: 'Gavin Roberts', igHandle: 'gavin.r', igHandleKey: 'gavin.r',
  linkedReportId: null, ...over,
});

test('the closer typed a full name; only the first word counts', () => {
  assert.equal(firstName('Gavin Roberts'), 'gavin');
  assert.equal(firstName('  MARCUS  '), 'marcus');
  assert.equal(firstName(''), '');
});

test('one call that day by somebody of that name is the answer', () => {
  const m = pickAutoMatch({ leadName: 'Gavin', callDate: day }, [lead()]);
  assert.deepEqual(m, { leadId: 'lead-1' });
});

test('two people called Gavin that day is a question for a person', () => {
  // This is the collision the whole queue exists for. Never pick one.
  const m = pickAutoMatch({ leadName: 'Gavin', callDate: day }, [
    lead(),
    lead({ id: 'lead-2', name: 'Gavin Smith', igHandle: 'gav.smith', igHandleKey: 'gav.smith' }),
  ]);
  assert.deepEqual(m, { leadId: null, why: 'more than one' });
});

test('nobody of that name that day stays in the queue', () => {
  const m = pickAutoMatch({ leadName: 'Marcus', callDate: day }, [lead()]);
  assert.deepEqual(m, { leadId: null, why: 'nobody that day' });
});

test('a report with no call date is never matched on the name alone', () => {
  // A first name across the whole pipeline is exactly the guess to avoid.
  const m = pickAutoMatch({ leadName: 'Gavin', callDate: null }, [lead()]);
  assert.deepEqual(m, { leadId: null, why: 'no date' });
});

test('a lead already carrying another report is not free to take this one', () => {
  const m = pickAutoMatch({ leadName: 'Gavin', callDate: day }, [
    lead({ linkedReportId: 'rep-9' }),
  ]);
  assert.deepEqual(m, { leadId: null, why: 'nobody that day' });
});

test('only the other one being taken leaves exactly one answer', () => {
  const m = pickAutoMatch({ leadName: 'Gavin', callDate: day }, [
    lead({ linkedReportId: 'rep-9' }),
    lead({ id: 'lead-2', name: 'Gavin Smith', igHandle: 'gav.s', igHandleKey: 'gav.s' }),
  ]);
  assert.deepEqual(m, { leadId: 'lead-2' });
});

test('a lead stored only as a handle still matches', () => {
  const m = pickAutoMatch({ leadName: 'Marcus', callDate: day }, [
    lead({ id: 'l2', name: null, igHandle: 'marcus.jones', igHandleKey: 'marcus.jones' }),
  ]);
  assert.deepEqual(m, { leadId: 'l2' });
});

test('a short name never sweeps up handles that merely contain it', () => {
  // "Jo" inside "jojo.fitness" is not a reason to put money on that lead.
  assert.equal(nameCouldMatch(lead({ name: null, igHandleKey: 'jojo.fitness' }), 'jo'), false);
  assert.equal(nameCouldMatch(lead({ name: 'Jo Baker' }), 'jo'), true, 'but a real first name does');
});

test('a shortened first name matches the longer one on the lead', () => {
  assert.equal(nameCouldMatch(lead({ name: 'Gavin Roberts' }), 'gavi'), true);
});

test('a name match is never reversed into a wrong person', () => {
  // "Gavin" must not match a lead called "Gav" - the report is the longer
  // name, so the lead is a different, shorter-named person.
  assert.equal(nameCouldMatch(lead({ name: 'Gav Smith', igHandleKey: 'gs' }), 'gavin'), false);
});

test('case and punctuation in either place do not matter', () => {
  const m = pickAutoMatch({ leadName: '  gAvIn ', callDate: day }, [
    lead({ name: 'Gavin  Roberts' }),
  ]);
  assert.deepEqual(m, { leadId: 'lead-1' });
});

test('no calls at all that day', () => {
  assert.deepEqual(pickAutoMatch({ leadName: 'Gavin', callDate: day }, []), {
    leadId: null,
    why: 'nobody that day',
  });
});
