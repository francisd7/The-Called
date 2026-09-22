'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { users } from '@/db/schema';
import { VIEW_AS_COOKIE } from './viewAsRules';

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Starts viewing the dashboard as somebody else.
 *
 * Checked against the real session rather than the effective one, so this can
 * only ever be started by an admin as themselves - you cannot hop from one
 * borrowed identity to another.
 */
export async function startViewingAs(formData: FormData): Promise<Result> {
  try {
    const session = await auth();
    if (session?.user?.role !== 'admin') return { ok: false, error: 'Admins only' };

    const targetId = formData.get('userId');
    if (typeof targetId !== 'string' || !targetId) {
      return { ok: false, error: 'Pick somebody to view as' };
    }
    if (targetId === session.user.id) return { ok: false, error: 'That is already you' };

    const row = await db.query.users.findFirst({ where: eq(users.id, targetId) });
    if (!row) return { ok: false, error: 'No such person' };
    if (!row.active) return { ok: false, error: `${row.name} is deactivated` };

    (await cookies()).set(VIEW_AS_COOKIE, row.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      // No maxAge: it lasts the browser session and no longer. Leaving it on
      // for days is the failure mode worth designing against.
    });

    revalidatePath('/', 'layout');
    return { ok: true, message: `Now viewing as ${row.name}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not switch' };
  }
}

/**
 * Deliberately has no guard. Clearing your own cookie can only ever return you
 * to yourself, and the one thing that must never fail is the way back.
 */
export async function stopViewingAs(): Promise<Result> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Back to your own view' };
}
