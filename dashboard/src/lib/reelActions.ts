'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { boostedReels } from '@/db/schema';
import { requireAdmin } from './session';
import { REEL_STATUSES, shortcodeFromUrl } from './reelMetrics';

type Result = { ok: true; message?: string } | { ok: false; error: string };

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * A blank box means "I haven't got this number", not zero, so it stays null.
 * A typed 0 is a real answer and is kept. Commas and currency symbols are
 * stripped because they are what Instagram and Ads Manager put on screen.
 */
function int(form: FormData, key: string): number | null {
  const raw = str(form, key);
  if (raw === null) return null;
  const n = Number(raw.replace(/[,\s$]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function money(form: FormData, key: string): string | null {
  const raw = str(form, key);
  if (raw === null) return null;
  const n = Number(raw.replace(/[,\s$]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** YYYY-MM-DD as a date input gives it, or nothing. */
function day(form: FormData, key: string): string | null {
  const raw = str(form, key);
  if (raw === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function fieldsFrom(formData: FormData) {
  const url = str(formData, 'reelUrl');
  const status = str(formData, 'status');

  return {
    reelUrl: url,
    // Worked out once on save rather than on every render, so a preview can
    // never disagree with the link beside it.
    shortcode: shortcodeFromUrl(url),
    hook: str(formData, 'hook'),
    postedOn: day(formData, 'postedOn'),
    status: (REEL_STATUSES as readonly string[]).includes(status ?? '') ? status! : 'running',
    boostStartedOn: day(formData, 'boostStartedOn'),
    boostEndedOn: day(formData, 'boostEndedOn'),
    spend: money(formData, 'spend'),
    spendCurrency: str(formData, 'spendCurrency') ?? 'USD',
    views: int(formData, 'views'),
    reach: int(formData, 'reach'),
    likes: int(formData, 'likes'),
    comments: int(formData, 'comments'),
    shares: int(formData, 'shares'),
    saves: int(formData, 'saves'),
    profileVisits: int(formData, 'profileVisits'),
    followsGained: int(formData, 'followsGained'),
    leadsGenerated: int(formData, 'leadsGenerated'),
    callsBooked: int(formData, 'callsBooked'),
    closes: int(formData, 'closes'),
    cashCollected: money(formData, 'cashCollected'),
    notes: str(formData, 'notes'),
    updatedAt: new Date(),
  };
}

export async function addReel(formData: FormData): Promise<Result> {
  try {
    const me = await requireAdmin();
    const title = str(formData, 'title');
    if (!title) return { ok: false, error: 'Give it a name so you can tell them apart' };

    await db.insert(boostedReels).values({
      ...fieldsFrom(formData),
      title,
      sortOrder: int(formData, 'sortOrder') ?? 0,
      createdById: me.id,
    });

    revalidatePath('/data');
    return { ok: true, message: `Added ${title}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add it' };
  }
}

export async function updateReel(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const id = str(formData, 'id');
    const title = str(formData, 'title');
    if (!id) return { ok: false, error: 'Missing reel' };
    if (!title) return { ok: false, error: 'Give it a name so you can tell them apart' };

    await db
      .update(boostedReels)
      .set({ ...fieldsFrom(formData), title, sortOrder: int(formData, 'sortOrder') ?? 0 })
      .where(eq(boostedReels.id, id));

    revalidatePath('/data');
    return { ok: true, message: 'Saved' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save' };
  }
}

export async function deleteReel(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const id = str(formData, 'id');
    if (!id) return { ok: false, error: 'Missing reel' };

    await db.delete(boostedReels).where(eq(boostedReels.id, id));
    revalidatePath('/data');
    return { ok: true, message: 'Removed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove it' };
  }
}
