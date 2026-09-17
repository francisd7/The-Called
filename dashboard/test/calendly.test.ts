import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  igHandleFromAnswers,
  leadIdFromTracking,
  normalizeIgHandle,
  verifyCalendlySignature,
} from '../src/lib/calendly.ts';

const KEY = 'test-signing-key';

function sign(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', KEY).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

test('accepts a correctly signed body', () => {
  const body = JSON.stringify({ event: 'invitee.created' });
  assert.deepEqual(verifyCalendlySignature(body, sign(body), KEY), { ok: true });
});

test('rejects a body that was altered after signing', () => {
  const body = JSON.stringify({ event: 'invitee.created' });
  const header = sign(body);
  const result = verifyCalendlySignature(body + ' ', header, KEY);
  assert.equal(result.ok, false);
});

test('rejects a signature made with a different key', () => {
  const body = '{}';
  const timestamp = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', 'wrong-key').update(`${timestamp}.${body}`).digest('hex');
  const result = verifyCalendlySignature(body, `t=${timestamp},v1=${v1}`, KEY);
  assert.equal(result.ok, false);
});

test('rejects a replayed delivery outside the tolerance window', () => {
  const body = '{}';
  const old = Math.floor(Date.now() / 1000) - 3600;
  const result = verifyCalendlySignature(body, sign(body, old), KEY);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /tolerance/);
});

test('rejects a missing or malformed header', () => {
  assert.equal(verifyCalendlySignature('{}', null, KEY).ok, false);
  assert.equal(verifyCalendlySignature('{}', 'garbage', KEY).ok, false);
  assert.equal(verifyCalendlySignature('{}', 't=123', KEY).ok, false);
});

test('normalizes the shapes people actually type an IG handle in', () => {
  for (const raw of [
    '@Modia_fit',
    'Modia_fit ',
    'MODIA_FIT',
    'instagram.com/modia_fit',
    'https://www.instagram.com/modia_fit/',
    'https://instagram.com/modia_fit?igshid=abc',
  ]) {
    assert.equal(normalizeIgHandle(raw), 'modia_fit', `failed for ${raw}`);
  }
  assert.equal(normalizeIgHandle('  '), null);
  assert.equal(normalizeIgHandle('@'), null);
  assert.equal(normalizeIgHandle(undefined), null);
});

test('reads the lead id back out of the tracking object', () => {
  const id = '9f1c4d2e-7b3a-4c5d-8e6f-0a1b2c3d4e5f';
  assert.equal(leadIdFromTracking({ tracking: { utm_content: id } }), id);
  assert.equal(leadIdFromTracking({ tracking: { utm_content: ` ${id} ` } }), id);
  assert.equal(leadIdFromTracking({ tracking: { salesforce_uuid: id } }), id);
});

test('ignores a tracking value that is not one of our ids', () => {
  // Anyone can append utm_content to a public Calendly link, so a non-uuid must
  // never reach the database as a lead id.
  assert.equal(leadIdFromTracking({ tracking: { utm_content: 'newsletter' } }), null);
  assert.equal(leadIdFromTracking({ tracking: { utm_content: "'; drop table leads--" } }), null);
  assert.equal(leadIdFromTracking({ tracking: {} }), null);
  assert.equal(leadIdFromTracking({}), null);
});

test('falls back to the booking form question for the IG handle', () => {
  const handle = igHandleFromAnswers({
    questions_and_answers: [
      { question: 'What is your biggest goal?', answer: 'Grow my brand' },
      { question: 'Your Instagram handle', answer: '@Grittraining_' },
    ],
  });
  assert.equal(handle, 'grittraining_');
  assert.equal(igHandleFromAnswers({ questions_and_answers: [] }), null);
  assert.equal(igHandleFromAnswers({}), null);
});
