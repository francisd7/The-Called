import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMissingReport,
  formatMissingReport,
} from '../src/reminders/weeklyCheckinReport.js';

function client(id, name, extra = {}) {
  return { id, fields: { 'Client Name': name, 'Discord ID': '123', CSM: { name: 'Noah Freedman' }, ...extra } };
}

function checkin(clientId, clientName, createdTime = '2026-09-10T23:00:00.000Z') {
  return {
    id: `chk-${clientId}`,
    createdTime,
    fields: { Client: [{ id: clientId, name: clientName }], 'Client (Name)': clientName },
  };
}

const CUTOFF = '2026-09-05T00:00:00.000Z';

test('a client with a check-in this week is not listed as missing', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Liam McCormack'), client('rec2', 'Jack Garcia')],
    checkinRecords: [checkin('rec1', 'Liam McCormack')],
    cutoffIso: CUTOFF,
  });
  assert.deepEqual(report.submitted.map((e) => e.clientName), ['Liam McCormack']);
  assert.deepEqual(report.missing.map((e) => e.clientName), ['Jack Garcia']);
  assert.equal(report.expectedCount, 2);
});

test('a check-in submitted before the reminder still counts', () => {
  // Both real check-ins on file arrived Thursday evening, before that week's
  // Friday DM. A "since the reminder" window would have called them misses.
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Hwan Bae')],
    checkinRecords: [checkin('rec1', 'Hwan Bae', '2026-09-10T23:20:02.000Z')],
    cutoffIso: '2026-09-05T16:00:00.000Z',
  });
  assert.equal(report.missing.length, 0);
});

test('a check-in from before the window does not count', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Jack Garcia')],
    checkinRecords: [checkin('rec1', 'Jack Garcia', '2026-08-01T10:00:00.000Z')],
    cutoffIso: CUTOFF,
  });
  assert.deepEqual(report.missing.map((e) => e.clientName), ['Jack Garcia']);
});

test('matching is by linked record id, so a rename is not a miss', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Jonathan Garcia')],
    checkinRecords: [checkin('rec1', 'Jack Garcia')],
    cutoffIso: CUTOFF,
  });
  assert.equal(report.missing.length, 0);
});

test('a check-in with no link falls back to the name', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Jack Garcia')],
    checkinRecords: [
      { id: 'chk1', createdTime: '2026-09-10T10:00:00.000Z', fields: { 'Client (Name)': ' jack garcia ' } },
    ],
    cutoffIso: CUTOFF,
  });
  assert.equal(report.missing.length, 0);
});

test('opted-out clients are never counted as missing', () => {
  // Listing someone who is not expected to check in is how a report trains
  // the team to ignore it.
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Wylie Hawkins', { 'Skip Weekly Reminder': true })],
    checkinRecords: [],
    cutoffIso: CUTOFF,
  });
  assert.equal(report.missing.length, 0);
  assert.equal(report.expectedCount, 0);
  assert.deepEqual(report.notExpected.map((e) => e.clientName), ['Wylie Hawkins']);
});

test('a client with no Discord ID is flagged — their miss is the team\'s fault', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Someone', { 'Discord ID': '  ' })],
    checkinRecords: [],
    cutoffIso: CUTOFF,
  });
  assert.equal(report.missing[0].hasDiscordId, false);
  assert.match(formatMissingReport(report), /never got the reminder/);
});

test('missing clients are grouped by CSM, biggest list first', () => {
  const report = buildMissingReport({
    clientRecords: [
      client('rec1', 'A', { CSM: { name: 'Nigel Daley' } }),
      client('rec2', 'B'),
      client('rec3', 'C'),
      client('rec4', 'D', { CSM: null }),
    ],
    checkinRecords: [],
    cutoffIso: CUTOFF,
  });
  const text = formatMissingReport(report);
  assert.match(text, /\*\*4 of 4 haven't submitted\.\*\*/);
  assert.ok(text.indexOf('**Noah Freedman** (2)') < text.indexOf('**Nigel Daley** (1)'));
  assert.match(text, /\*\*Unassigned\*\* \(1\)/);
});

test('a clean week says so instead of printing an empty section', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'A')],
    checkinRecords: [checkin('rec1', 'A')],
    cutoffIso: CUTOFF,
  });
  assert.match(formatMissingReport(report), /All 1 checked in\. Nothing to chase\./);
});

test('the week label appears in the heading when given', () => {
  const report = buildMissingReport({ clientRecords: [], checkinRecords: [], cutoffIso: CUTOFF });
  assert.match(formatMissingReport(report, { weekLabel: '2026-09-12' }), /week ending 2026-09-12/);
});

test('a client who started this week is too new to be a miss', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Gavin OBrien', { 'Start Date': '2026-09-11' })],
    checkinRecords: [],
    cutoffIso: CUTOFF,
    startedAfterDate: '2026-09-05',
  });
  assert.equal(report.missing.length, 0);
  assert.deepEqual(report.tooNew.map((e) => e.clientName), ['Gavin OBrien']);
  // Not counted against the total either - 0 of 0, not 0 of 1.
  assert.equal(report.expectedCount, 0);
  assert.match(formatMissingReport(report), /Too new to expect one \(1\): Gavin OBrien/);
});

test('the same client is expected the following week, with no human action', () => {
  // The grace is a rolling comparison against Start Date, not a flag someone
  // has to remember to clear - which is the failure mode of using Skip Weekly
  // Reminder for this.
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'Gavin OBrien', { 'Start Date': '2026-09-11' })],
    checkinRecords: [],
    cutoffIso: CUTOFF,
    startedAfterDate: '2026-09-12',
  });
  assert.equal(report.tooNew.length, 0);
  assert.deepEqual(report.missing.map((e) => e.clientName), ['Gavin OBrien']);
});

test('a client starting exactly on the boundary is expected, not excused', () => {
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'A', { 'Start Date': '2026-09-05' })],
    checkinRecords: [],
    cutoffIso: CUTOFF,
    startedAfterDate: '2026-09-05',
  });
  assert.equal(report.missing.length, 1);
});

test('a missing Start Date does not excuse anyone', () => {
  // Otherwise a blank field is a silent way to disappear from the report.
  const report = buildMissingReport({
    clientRecords: [client('rec1', 'No Date', { 'Start Date': undefined })],
    checkinRecords: [],
    cutoffIso: CUTOFF,
    startedAfterDate: '2026-09-05',
  });
  assert.equal(report.tooNew.length, 0);
  assert.equal(report.missing.length, 1);
});
