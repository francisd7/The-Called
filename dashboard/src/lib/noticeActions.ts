'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '@/db';
import { noticeSnoozes } from '@/db/schema';
import { requireUser } from './session';

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Long enough to stop being furniture, short enough to come back. */
const SNOOZE_DAYS = 7;

export async function snoozeNotice(formData: FormData): Promise<Result> {
  try {
    const me = await requireUser();
    const key = formData.get('key');
    if (typeof key !== 'string' || !key) return { ok: false, error: 'Missing notice' };

    const until = new Date(Date.now() + SNOOZE_DAYS * 86_400_000);
    await db
      .insert(noticeSnoozes)
      .values({ key, until, byId: me.id })
      .onConflictDoUpdate({ target: noticeSnoozes.key, set: { until, byId: me.id } });

    revalidatePath('/');
    return { ok: true, message: `Hidden for ${SNOOZE_DAYS} days` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not hide it' };
  }
}
