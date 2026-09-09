import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeEmail, normalizeEmail } from '../src/onboarding/email.js';

test('looksLikeEmail accepts plausible emails', () => {
  assert.equal(looksLikeEmail('jane@example.com'), true);
  assert.equal(looksLikeEmail('  jane@example.com  '), true);
  assert.equal(looksLikeEmail('Jane.Doe+test@sub.example.co.uk'), true);
});

test('looksLikeEmail rejects obviously-not-an-email text', () => {
  assert.equal(looksLikeEmail('hey what is up'), false);
  assert.equal(looksLikeEmail('jane at example dot com'), false);
  assert.equal(looksLikeEmail(''), false);
  assert.equal(looksLikeEmail(undefined), false);
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Jane@Example.COM  '), 'jane@example.com');
});
