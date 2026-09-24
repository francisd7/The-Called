'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { monthlyTargets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from './session';
import { TARGET_METRICS } from './targets';

type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function setTargets(formData: FormData): Promise<Result> {
  try {
    const me = await requireAdmin();

    for (const { key } of TARGET_METRICS) {
      const raw = formData.get(key);
      const text = typeof raw === 'string' ? raw.replace(/[,\s$]/g, '').trim() : '';

      // Cleared on purpose, which is different from set to nothing: the bar
      // goes away rather than showing everything as a miss.
      if (text === '') {
        await db.delete(monthlyTargets).where(eq(monthlyTargets.metric, key));
        continue;
      }

      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${key} is not a number` };

      await db
        .insert(monthlyTargets)
        .values({ metric: key, value: n.toFixed(2), setById: me.id, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: monthlyTargets.metric,
          set: { value: n.toFixed(2), setById: me.id, updatedAt: new Date() },
        });
    }

    revalidatePath('/');
    revalidatePath('/admin/setup');
    return { ok: true, message: 'Targets saved' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save' };
  }
}
