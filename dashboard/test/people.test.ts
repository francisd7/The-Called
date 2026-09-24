import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { colourOrder, personColour, PERSON_COLOURS, toneFor } from '../src/lib/people.ts';

const p = (id: string, name: string, over: Partial<{ role: string; active: boolean }> = {}) => ({
  id, name, role: 'setter', active: true, ...over,
});

test('two people never share a colour', () => {
  const people = [p('a', 'Alexis'), p('b', 'Loui')];
  const order = colourOrder(people);
  assert.notEqual(personColour({ id: 'a' }, order), personColour({ id: 'b' }, order));
});

test('colour follows the person, not what is on screen', () => {
  // The whole bug: filtering to one person must not repaint them.
  const order = colourOrder([p('a', 'Alexis'), p('b', 'Loui'), p('c', 'Francis', { role: 'admin' })]);
  const loui = personColour({ id: 'b' }, order);
  assert.equal(personColour({ id: 'b' }, order), loui);
  assert.equal(toneFor('b', order), order.indexOf('b') + 1);
});

test('the order is by name, so it does not move when a row is added', () => {
  const order = colourOrder([p('b', 'Loui'), p('a', 'Alexis')]);
  assert.deepEqual(order, ['a', 'b']);
});

test('closers do not spend a colour, since they never own a tile', () => {
  const order = colourOrder([p('a', 'Alexis'), p('z', 'Andrew', { role: 'closer' }), p('b', 'Loui')]);
  assert.deepEqual(order, ['a', 'b']);
});

test('a deactivated person is out of the order', () => {
  const order = colourOrder([p('a', 'Alexis'), p('x', 'Gone', { active: false })]);
  assert.deepEqual(order, ['a']);
});

test('a colour set on the record wins, so it can be corrected without a deploy', () => {
  const order = colourOrder([p('a', 'Alexis'), p('b', 'Loui')]);
  assert.equal(personColour({ id: 'a', color: 'pink' }, order), 'pink');
});

test('a colour nobody recognises is ignored rather than rendered', () => {
  const order = colourOrder([p('a', 'Alexis')]);
  assert.equal(personColour({ id: 'a', color: 'chartreuse' }, order), PERSON_COLOURS[0]);
});

test('somebody outside the order still gets a colour', () => {
  assert.ok(PERSON_COLOURS.includes(personColour({ id: 'nobody' }, ['a', 'b'])));
});

test('more people than colours wraps rather than running out', () => {
  const many = Array.from({ length: 7 }, (_, i) => p(`p${i}`, `Person ${i}`));
  const order = colourOrder(many);
  const all = order.map((id) => personColour({ id }, order));
  assert.equal(all.length, 7);
  assert.ok(all.every((c) => PERSON_COLOURS.includes(c)));
  assert.equal(all[0], all[5], 'the sixth wraps back to the first');
});
