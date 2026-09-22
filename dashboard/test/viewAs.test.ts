import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveViewAs } from '../src/lib/viewAsRules.ts';

const admin = { id: 'admin-1', name: 'Francis', role: 'admin' };
const setter = { id: 'setter-1', name: 'Loui', role: 'setter' };
const loui = { id: 'setter-1', name: 'Loui', role: 'setter', active: true };

test('with no cookie you are yourself', () => {
  const me = resolveViewAs(admin, undefined, null);
  assert.equal(me.id, 'admin-1');
  assert.equal(me.viewingAs, null);
});

test('an admin viewing a setter takes on their id and their role', () => {
  const me = resolveViewAs(admin, 'setter-1', loui);
  assert.equal(me.id, 'setter-1');
  assert.equal(me.name, 'Loui');
  // The role is the point: an admin who kept their own would still see the
  // admin menu and the admin-only pages, which is not what the setter sees.
  assert.equal(me.role, 'setter');
  assert.equal(me.viewingAs?.realName, 'Francis');
});

test('a setter cannot view as anybody, whatever the cookie says', () => {
  // The cookie is only a user id, so this is the request a setter could make
  // by hand. Honouring it would hand them the admin pages.
  const me = resolveViewAs(setter, 'admin-1', { ...admin, active: true });
  assert.equal(me.id, 'setter-1');
  assert.equal(me.role, 'setter');
  assert.equal(me.viewingAs, null);
});

test('a deactivated person is never viewable', () => {
  const me = resolveViewAs(admin, 'setter-1', { ...loui, active: false });
  assert.equal(me.id, 'admin-1');
  assert.equal(me.viewingAs, null);
});

test('a cookie naming nobody leaves you as yourself', () => {
  const me = resolveViewAs(admin, 'ghost', null);
  assert.equal(me.id, 'admin-1');
  assert.equal(me.viewingAs, null);
});

test('a cookie that does not match the row it was looked up by is refused', () => {
  // Guards the seam between the lookup and the decision: if the two ever
  // disagree, the safe answer is you.
  const me = resolveViewAs(admin, 'setter-1', { ...loui, id: 'someone-else' });
  assert.equal(me.id, 'admin-1');
  assert.equal(me.viewingAs, null);
});

test('viewing as yourself is not viewing as anybody', () => {
  const me = resolveViewAs(admin, 'admin-1', { ...admin, active: true });
  assert.equal(me.viewingAs, null);
});
