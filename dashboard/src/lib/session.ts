import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { resolveViewAs, VIEW_AS_COOKIE, type CurrentUser } from './viewAsRules';

export { VIEW_AS_COOKIE, type CurrentUser };

/**
 * Who the dashboard should behave as for this request.
 *
 * Everything that asks "who is this?" goes through here rather than calling
 * auth() directly, which is the whole point: an admin viewing as a setter has
 * to change what the queries return, not just what the header says. A preview
 * that only relabels the page would show Francis a working dashboard while the
 * setter is looking at a broken one - worse than not having it.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const real = {
    id: session.user.id,
    name: session.user.name ?? 'Someone',
    role: session.user.role,
  };

  const cookieValue = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  // Skip the lookup entirely when the answer cannot change.
  if (!cookieValue || cookieValue === real.id || real.role !== 'admin') {
    return { ...real, viewingAs: null };
  }

  const row = await db.query.users.findFirst({ where: eq(users.id, cookieValue) });
  return resolveViewAs(real, cookieValue, row);
}

/** Thrown by the guards below rather than returned, so an action that forgets to check still fails closed. */
export class ReadOnlyError extends Error {
  constructor() {
    super('Viewing as somebody else is read-only. Stop viewing as them to make changes.');
    this.name = 'ReadOnlyError';
  }
}

/**
 * Every server action goes through this. Server actions are reachable by anyone
 * who can guess the endpoint, so the session is re-checked here rather than
 * trusted from whatever page rendered the form.
 *
 * Viewing as somebody is deliberately look-only. A stray click would otherwise
 * land a follow-up, an EOD or a contract value on their record under their
 * name, and those are the numbers the team is measured on.
 */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  if (user.viewingAs) throw new ReadOnlyError();
  return { id: user.id, name: user.name, role: user.role };
}

/**
 * For housekeeping that runs on its own rather than because somebody pressed
 * something - the post-call sync, the weekly backup.
 *
 * Returns null when there is nobody signed in, or when an admin is viewing as
 * somebody else. The caller stops there: a background task has no business
 * writing inside a read-only preview, and it loses nothing by waiting for the
 * next ordinary page load moments later.
 *
 * Separate from requireUser because that one throws, and a background task
 * that throws where a person did nothing wrong reports itself as a fault.
 */
export async function backgroundUser() {
  const user = await currentUser();
  if (!user || user.viewingAs) return null;
  return { id: user.id, name: user.name, role: user.role };
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'admin') throw new Error('Admins only');
  return user;
}
