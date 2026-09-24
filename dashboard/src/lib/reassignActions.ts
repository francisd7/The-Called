'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { leadEvents, leads, users } from '@/db/schema';
import { requireAdmin } from './session';
import { planReassign, type ReassignRow } from './reassignRules';

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** The value the "Whose leads" dropdown uses for the pile nobody owns. */
const UNASSIGNED = 'unassigned';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const leadCount = (n: number) => `${n} ${n === 1 ? 'lead' : 'leads'}`;

const field = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/**
 * Splits one person's pile of leads across two dates.
 *
 * Cash is attributed to whoever owns the lead, so this moves money between
 * people's numbers - which is why it reports before it writes, and why the
 * dry run is the default action rather than a checkbox.
 */
export async function reassignByDate(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();

    const fromRaw = field(formData, 'fromSetterId');
    const toSetterId = field(formData, 'toSetterId');
    const first = field(formData, 'first');
    const last = field(formData, 'last');
    const dryRun = formData.get('dryRun') === '1';

    if (!fromRaw || !toSetterId) return { ok: false, error: 'Pick both people' };
    // A blank Setter column in the old tracker imports as nobody, so the pile
    // that needs splitting is usually the unassigned one.
    const fromSetterId = fromRaw === UNASSIGNED ? null : fromRaw;

    if (!first || !last) return { ok: false, error: 'Both dates are needed' };
    if (fromSetterId === toSetterId) return { ok: false, error: 'Those are the same person' };
    if (first > last) {
      // The exact case the rule as first described ran into. Saying so beats
      // reporting that nothing moved.
      return {
        ok: false,
        error: `The first date (${first}) is after the second (${last}), so the middle band is empty and nobody would receive anything.`,
      };
    }

    const rows: ReassignRow[] = await db
      .select({
        id: leads.id,
        setterId: leads.setterId,
        createdOn: sql<string>`to_char(${leads.leadCreatedAt} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`,
        cashCollected: leads.cashCollected,
      })
      .from(leads)
      .where(eq(leads.isTest, false));

    const plan = planReassign(rows, { fromSetterId, first, last, toSetterId });

    // Named rather than implied: the message says where the money went, and
    // "moved to Loui" is checkable in a way that "moved" is not.
    const everyone = await db.select({ id: users.id, name: users.name }).from(users);
    const nameById = new Map(everyone.map((u) => [u.id, u.name]));
    const toName = nameById.get(toSetterId) ?? 'the other person';

    // Every dated row lands in exactly one band and every undated one is
    // counted, so all four being zero means the pile itself is empty. Three
    // zeroes look like a date problem, which is the one thing it is not - so
    // say where the leads actually are instead.
    const matched =
      plan.band.before.leads + plan.band.middle.leads + plan.band.after.leads + plan.undated;
    if (matched === 0) {
      const fromName = fromSetterId ? (nameById.get(fromSetterId) ?? 'that person') : 'Unassigned';
      if (rows.length === 0) {
        return { ok: false, error: 'There are no leads to move.' };
      }
      const tally = new Map<string, number>();
      for (const row of rows) {
        const key = row.setterId ?? 'unassigned';
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      const where = [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, n]) => `${key === 'unassigned' ? 'Unassigned' : (nameById.get(key) ?? key)} ${n}`)
        .join(' · ');
      return {
        ok: false,
        error: `${fromName} has no leads, so there is nothing to split. They are on: ${where}. Pick the right one under "Whose leads".`,
      };
    }

    // Stated as noun phrases so the counts read for one lead and for many.
    const summary =
      `Before ${first} — ${leadCount(plan.band.before.leads)}, ${money(plan.band.before.cash)}, left alone · ` +
      `${first} to ${last} — ${leadCount(plan.band.middle.leads)}, ${money(plan.band.middle.cash)}, to ${toName} · ` +
      `after ${last} — ${leadCount(plan.band.after.leads)}, ${money(plan.band.after.cash)}, unassigned` +
      (plan.undated > 0 ? ` · ${plan.undated} skipped, no created date` : '');

    if (dryRun) return { ok: true, message: `Dry run — ${summary}` };
    if (plan.moves.length === 0) return { ok: true, message: `Nothing to move. ${summary}` };

    const movedToPerson = plan.moves.filter((m) => m.to !== null).map((m) => m.id);
    const toNobody = plan.moves.filter((m) => m.to === null).map((m) => m.id);

    for (let i = 0; i < movedToPerson.length; i += 200) {
      await db
        .update(leads)
        .set({ setterId: toSetterId })
        .where(inArray(leads.id, movedToPerson.slice(i, i + 200)));
    }
    for (let i = 0; i < toNobody.length; i += 200) {
      await db
        .update(leads)
        .set({ setterId: null })
        .where(inArray(leads.id, toNobody.slice(i, i + 200)));
    }

    // Written down, because this moves money between people's figures and the
    // lead's own history should say when and why it changed hands.
    for (let i = 0; i < plan.moves.length; i += 200) {
      await db.insert(leadEvents).values(
        plan.moves.slice(i, i + 200).map((m) => ({
          leadId: m.id,
          actorId: null,
          type: 'setter_reassigned_by_date',
          toValue: m.to ?? 'unassigned',
          meta: { first, last, fromSetterId: fromSetterId ?? 'unassigned' },
        }))
      );
    }

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath('/admin/setup');
    return { ok: true, message: summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reassign' };
  }
}
