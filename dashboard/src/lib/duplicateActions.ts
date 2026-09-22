'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from './session';
import { db } from '@/db';
import { dismissPair, mergeLeads } from './duplicates';

type Result = { ok: true; message?: string } | { ok: false; error: string };

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function ids(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function refresh() {
  revalidatePath('/leads/duplicates');
  revalidatePath('/leads');
  revalidatePath('/');
  revalidatePath('/kpis');
}

/**
 * Folds every other row in the group into the one somebody chose.
 *
 * One at a time rather than in one go: each merge re-reads the lead being kept,
 * so a third row fills in whatever the second one didn't, instead of both being
 * measured against the row as it looked before either had been applied.
 */
export async function mergeDuplicate(formData: FormData): Promise<Result> {
  try {
    const { id: actorId } = await requireUser();
    const keepId = field(formData, 'keepId');
    const dropIds = ids(formData, 'dropId').filter((id) => id !== keepId);
    if (!keepId || dropIds.length === 0) {
      return { ok: false, error: 'Nothing to merge into this lead' };
    }

    const brought: string[] = [];
    for (const dropId of dropIds) {
      const res = await mergeLeads(db, { keepId, dropId, actorId });
      if (!res.ok) return res;
      for (const b of res.brings) if (!brought.includes(b)) brought.push(b);
    }

    refresh();
    const rows = dropIds.length === 1 ? 'The other row' : `The other ${dropIds.length} rows`;
    return {
      ok: true,
      message:
        brought.length > 0
          ? `Merged. Brought across ${brought.join(', ')}.`
          : `Merged. ${rows} had nothing this one was missing.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Merge failed' };
  }
}

/** Rules out every pair in the group at once, so none of them comes back. */
export async function markNotDuplicates(formData: FormData): Promise<Result> {
  try {
    const { id: actorId } = await requireUser();
    const leadIds = ids(formData, 'leadId');
    if (leadIds.length < 2) return { ok: false, error: 'Need two leads to tell apart' };

    for (let i = 0; i < leadIds.length; i++) {
      for (let j = i + 1; j < leadIds.length; j++) {
        await dismissPair(db, { aId: leadIds[i], bId: leadIds[j], actorId });
      }
    }

    refresh();
    return { ok: true, message: 'Left alone — you won’t be asked about these again.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save that' };
  }
}
