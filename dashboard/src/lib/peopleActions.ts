'use server';

import { revalidatePath } from 'next/cache';
import { count, eq, ne, and } from 'drizzle-orm';
import { requireAdmin } from './session';
import { db } from '@/db';
import { users } from '@/db/schema';

type Result = { ok: true; message?: string } | { ok: false; error: string };

const ROLES = ['admin', 'setter', 'closer'] as const;
type Role = (typeof ROLES)[number];

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function savePerson(formData: FormData): Promise<Result> {
  try {
    const me = await requireAdmin();

    const id = field(formData, 'id');
    const email = field(formData, 'email')?.toLowerCase();
    const name = field(formData, 'name');
    const role = field(formData, 'role') as Role | null;
    const active = formData.get('active') === 'on';

    if (!email) return { ok: false, error: 'An email address is required' };
    if (!email.includes('@')) return { ok: false, error: `"${email}" is not an email address` };
    if (!name) return { ok: false, error: 'A name is required' };
    if (!role || !ROLES.includes(role)) return { ok: false, error: 'Pick a role' };

    // Sign-in matches on email, so two rows sharing one address would make
    // which role someone gets a coin flip.
    const clash = await db.query.users.findFirst({
      where: id ? and(eq(users.email, email), ne(users.id, id)) : eq(users.email, email),
    });
    if (clash) return { ok: false, error: `${email} is already used by ${clash.name}` };

    if (id) {
      // Removing your own admin rights, or deactivating yourself, locks you out
      // of this screen - and possibly leaves nobody who can undo it.
      if (id === me.id && (role !== 'admin' || !active)) {
        return { ok: false, error: 'You cannot remove your own admin access' };
      }
      if (role !== 'admin' || !active) {
        const [{ admins }] = await db
          .select({ admins: count() })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)));
        if (admins === 0) return { ok: false, error: 'That would leave no active admin' };
      }
      await db.update(users).set({ email, name, role, active }).where(eq(users.id, id));
    } else {
      await db.insert(users).values({ email, name, role, active });
    }

    revalidatePath('/admin/people');
    revalidatePath('/admin');
    return { ok: true, message: `Saved ${name}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save' };
  }
}

export async function removePerson(formData: FormData): Promise<Result> {
  try {
    const me = await requireAdmin();
    const id = field(formData, 'id');
    if (!id) return { ok: false, error: 'Missing person' };
    if (id === me.id) return { ok: false, error: 'You cannot remove yourself' };

    const person = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!person) return { ok: false, error: 'Already gone' };

    // Deactivate rather than delete: leads, notes, confirmations and triages
    // all reference the person who did them, and deleting the row would either
    // fail or strip that history off the work they did.
    await db.update(users).set({ active: false }).where(eq(users.id, id));

    revalidatePath('/admin/people');
    revalidatePath('/admin');
    return { ok: true, message: `${person.name} can no longer sign in. Their history is kept.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove' };
  }
}
