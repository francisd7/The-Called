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
