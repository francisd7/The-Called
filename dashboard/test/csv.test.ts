import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toCsv } from '../src/lib/csv.ts';

const head = (s: string) => s.split('\r\n')[0];
const row = (s: string, n = 1) => s.split('\r\n')[n];

test('plain values come out plain', () => {
  const out = toCsv(['a', 'b'], [{ a: 'one', b: 2 }]);
  assert.equal(head(out), 'a,b');
  assert.equal(row(out), 'one,2');
});

test('a comma in a note does not shift every column after it', () => {
  // This is the whole reason this module exists.
  const out = toCsv(['note'], [{ note: 'Bad fit, no money' }]);
  assert.equal(row(out), '"Bad fit, no money"');
});

test('a quote inside a field is doubled, not dropped', () => {
  const out = toCsv(['note'], [{ note: 'He said "later"' }]);
  assert.equal(row(out), '"He said ""later"""');
});

test('a newline inside a note stays inside its cell', () => {
  const out = toCsv(['note'], [{ note: 'line one\nline two' }]);
  assert.equal(out, 'note\r\n"line one\nline two"\r\n');
});

test('nothing and empty are both blank, not the words null or undefined', () => {
  const out = toCsv(['a', 'b', 'c'], [{ a: null, b: undefined, c: '' }]);
  assert.equal(row(out), ',,');
});

test('a missing key is blank rather than a crash', () => {
  const out = toCsv(['a', 'b'], [{ a: 'x' }]);
  assert.equal(row(out), 'x,');
});

test('dates go out in a form a spreadsheet can read back', () => {
  const out = toCsv(['at'], [{ at: new Date('2026-09-22T14:30:00Z') }]);
  assert.equal(row(out), '2026-09-22T14:30:00.000Z');
});

test('a value starting with = is not handed to Excel as a formula', () => {
  // A handle or note beginning with = or + would otherwise execute on open.
  assert.equal(row(toCsv(['x'], [{ x: '=1+1' }])), "'=1+1");
  assert.equal(row(toCsv(['x'], [{ x: '+44 7700 900000' }])), "'+44 7700 900000");
  assert.equal(row(toCsv(['x'], [{ x: '@handle' }])), "'@handle");
});

test('a negative number stays a number a spreadsheet can add up', () => {
  // -180 is a real value in the net column. The formula guard is for text, and
  // a number cannot carry a formula, so it goes out bare.
  assert.equal(row(toCsv(['x'], [{ x: -180 }])), '-180');
});

test('but text that merely looks numeric is still guarded', () => {
  // A handle or a note is text whatever it looks like.
  assert.equal(row(toCsv(['x'], [{ x: '-1+1' }])), "'-1+1");
});

test('false and zero survive', () => {
  const out = toCsv(['a', 'b'], [{ a: false, b: 0 }]);
  assert.equal(row(out), 'false,0');
});

test('no rows still gives a header', () => {
  assert.equal(toCsv(['a', 'b'], []), 'a,b\r\n');
});

test('every row ends with CRLF including the last', () => {
  const out = toCsv(['a'], [{ a: '1' }, { a: '2' }]);
  assert.equal(out, 'a\r\n1\r\n2\r\n');
});

// --- reading it back --------------------------------------------------------
import { parseCsv, unguard } from '../src/lib/csv.ts';

test('what we write, we can read', () => {
  const rows = [
    { a: 'plain', b: 'has, comma', c: 'has "quotes"', d: 'two\nlines' },
    { a: '', b: null, c: 0, d: false },
  ];
  const back = parseCsv(toCsv(['a', 'b', 'c', 'd'], rows));
  assert.deepEqual(back[0], ['a', 'b', 'c', 'd']);
  assert.deepEqual(back[1], ['plain', 'has, comma', 'has "quotes"', 'two\nlines']);
  assert.deepEqual(back[2], ['', '', '0', 'false']);
});

test('a file a spreadsheet saved still parses', () => {
  // Excel writes a byte order mark and sometimes bare LF endings.
  const rows = parseCsv('﻿a,b\n1,2\n');
  assert.deepEqual(rows[0], ['a', 'b'], 'the mark must not stick to the first column name');
  assert.deepEqual(rows[1], ['1', '2']);
});

test('a last row with no trailing newline is not dropped', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('the formula guard comes back off', () => {
  assert.equal(unguard("'=1+1"), '=1+1');
  assert.equal(unguard("'@handle"), '@handle');
  // An apostrophe that was always part of the text stays put.
  assert.equal(unguard("'tis a note"), "'tis a note");
  assert.equal(unguard('plain'), 'plain');
});

test('a guarded value survives a full round trip unchanged', () => {
  const out = toCsv(['x'], [{ x: '=SUM(A1)' }]);
  assert.equal(unguard(parseCsv(out)[1][0]), '=SUM(A1)');
});
