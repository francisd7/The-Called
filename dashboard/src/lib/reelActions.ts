'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { boostedReels } from '@/db/schema';
import { requireAdmin } from './session';
import { REEL_STATUSES, shortcodeFromUrl } from './reelMetrics';
import { parseAdsExport, planAdsImport, type AdPlan } from './adsImport';

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
    adName: str(formData, 'adName'),
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
    impressions: int(formData, 'impressions'),
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

    revalidatePath('/ads');
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

    revalidatePath('/ads');
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
    revalidatePath('/ads');
    return { ok: true, message: 'Removed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove it' };
  }
}

/* ------------------------------------------------------------------------- *
 * The Ads Manager export
 * ------------------------------------------------------------------------- */

/** A line per ad, so the dry run reads as a list of decisions rather than counts. */
function reportLine(plan: AdPlan): string {
  const name = plan.reelTitle;
  if (plan.matchedBy === 'ambiguous') return `${name}: ${plan.kept.join(' ')}`;

  const where =
    plan.matchedBy === 'new'
      ? `${name} (new reel)`
      : plan.matchedBy === 'title'
        ? `${name} (matched on its name)`
        : name;

  const bits = plan.changes.map((c) => `${c.label} ${c.from ?? 'blank'} → ${c.to}`);
  const body = bits.length > 0 ? bits.join(', ') : 'nothing to change';
  return [`${where}: ${body}`, ...plan.kept].join(' · ');
}

/**
 * Reads a Meta Ads Manager CSV onto the reels.
 *
 * The dry run is the point of this rather than a nicety: an export window is
 * chosen in Ads Manager and there is nothing in the file that says whether it
 * covers a whole boost or two days of one, so the only way to know a number is
 * right is to read what it would change before it changes.
 */
export async function importAdsExport(formData: FormData): Promise<Result> {
  try {
    const me = await requireAdmin();
    const dryRun = formData.get('dryRun') === '1';
    const replace = formData.get('replace') === '1';

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: 'Pick the CSV you downloaded from Ads Manager' };
    }

    const parsed = parseAdsExport(await file.text());
    if (parsed.ads.length === 0) {
      return { ok: false, error: parsed.notes.join(' ') || 'Nothing in that file.' };
    }

    const reels = await db
      .select({
        id: boostedReels.id,
        title: boostedReels.title,
        adName: boostedReels.adName,
        spend: boostedReels.spend,
        spendCurrency: boostedReels.spendCurrency,
        impressions: boostedReels.impressions,
        reach: boostedReels.reach,
        profileVisits: boostedReels.profileVisits,
        boostStartedOn: boostedReels.boostStartedOn,
      })
      .from(boostedReels);

    const plan = planAdsImport(reels, parsed, { replace });

    if (!dryRun) {
      for (const ad of plan.ads) {
        if (Object.keys(ad.patch).length === 0) continue;
        if (ad.reelId) {
          await db
            .update(boostedReels)
            .set({ ...ad.patch, updatedAt: new Date() })
            .where(eq(boostedReels.id, ad.reelId));
        } else {
          await db.insert(boostedReels).values({
            ...ad.patch,
            title: ad.reelTitle,
            adName: ad.ad.adName,
            createdById: me.id,
          });
        }
      }
      revalidatePath('/ads');
    }

    // Counted off the patches rather than the matches, so an ad that matched a
    // reel but moved no number is not reported as an update.
    const changing = plan.ads.filter((a) => Object.keys(a.patch).length > 0);
    const added = changing.filter((a) => a.reelId === null).length;
    const updated = changing.length - added;

    const nReels = (n: number) => `${n} ${n === 1 ? 'reel' : 'reels'}`;
    const parts: string[] = [];
    if (updated > 0)
      parts.push(dryRun ? `${nReels(updated)} would change` : `${nReels(updated)} updated`);
    if (added > 0) parts.push(dryRun ? `${nReels(added)} would be added` : `${nReels(added)} added`);
    if (parts.length === 0) parts.push(dryRun ? 'nothing would change' : 'nothing changed');
    const head = `${dryRun ? 'Dry run — ' : ''}${parts.join(', ')}.`;

    const window =
      parsed.ads[0].firstDay && parsed.ads[0].lastDay
        ? `Covers ${parsed.ads[0].firstDay} to ${parsed.ads[0].lastDay}.`
        : '';

    const advice =
      added === 0
        ? ''
        : dryRun
          ? `${added === 1 ? 'One ad does' : `${added} ads do`} not match a reel here yet. To put ` +
            `${added === 1 ? 'its' : 'their'} numbers on a reel that already exists instead, paste ` +
            'the ad name into that reel\'s "Ad name in Ads Manager" box and run this again.'
          : `${added === 1 ? 'The new reel' : 'The new reels'} came in under the ad name, so give ` +
            `${added === 1 ? 'it' : 'them'} a proper name and an Instagram link.`;

    return {
      ok: true,
      message: [head, window, ...plan.ads.map(reportLine), ...plan.notes, advice]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read that file' };
  }
}
