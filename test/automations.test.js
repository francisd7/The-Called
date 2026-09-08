import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage as formatSetterEod } from '../src/automations/setterEod.js';
import { formatMessage as formatWeeklyCheckin } from '../src/automations/weeklyCheckin.js';

test('formats setter EOD message', () => {
  const record = { fields: { 'Setter Name': 'Alex', Date: '2026-09-08' } };
  assert.equal(
    formatSetterEod(record),
    '📋 **Alex** submitted their EOD report — September 8, 2026'
  );
});

test('setter EOD message falls back when fields are missing', () => {
  const record = { fields: {} };
  assert.equal(
    formatSetterEod(record),
    '📋 **Someone** submitted their EOD report — an unknown date'
  );
});

test('formats weekly check-in message', () => {
  const record = { fields: { 'Client (Name)': 'Acme Co', 'Momentum Rating (1-10)': 7 } };
  assert.equal(
    formatWeeklyCheckin(record),
    '✅ **Acme Co** submitted their Weekly Check-in — Momentum: 7/10'
  );
});

test('weekly check-in message handles an unrated momentum field', () => {
  const record = { fields: { 'Client (Name)': 'Acme Co' } };
  assert.equal(
    formatWeeklyCheckin(record),
    '✅ **Acme Co** submitted their Weekly Check-in — Momentum: not rated'
  );
});
