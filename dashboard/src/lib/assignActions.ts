'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray, sql } from 'drizzle-orm';
import { requireUser } from './session';
import { db } from '@/db';
import { leadEvents, leads, users } from '@/db/schema';
import { planBulkAssign } from './assignRules';
import { teamDateString } from './dates';

type Result = { ok: true; message?: string } | { ok: false; error: string };

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * For bookings that arrive without a setter - someone who booked straight off a
 * link rather than through a DM conversation. Whoever presses it takes the lead.
 */
export async function claimLead(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const leadId = field(formData, 'leadId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead) return { ok: false, error: 'Lead not found' };

    // First-come, but it must never quietly take a lead off a colleague who is
    // already working it. A lead parked with an admin is the imported backlog
    // rather than someone's work, so that one is claimable.
    if (lead.setterId && lead.setterId !== user.id) {
      const owner = await db.query.users.findFirst({ where: eq(users.id, lead.setterId) });
      if (owner && owner.role === 'setter') {
        return { ok: false, error: `Already being worked by ${owner.name}` };
      }
    }

    await db
      .update(leads)
      .set({ setterId: user.id, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    await db.insert(leadEvents).values({
      leadId,
      actorId: user.id,
      type: 'claimed',
      toValue: user.name,
    });

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: `Claimed by ${user.name}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not claim' };
  }
}

export async function setSetter(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const leadId = field(formData, 'leadId');
    const setterId = field(formData, 'setterId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    const before = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    const named = setterId
      ? await db.query.users.findFirst({ where: eq(users.id, setterId) })
      : null;

    await db
      .update(leads)
      .set({ setterId: setterId ?? null, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    await db.insert(leadEvents).values({
      leadId,
      actorId: user.id,
      type: 'setter_changed',
      fromValue: before?.setterId ?? null,
      toValue: named?.name ?? null,
    });

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: named ? `Setter: ${named.name}` : 'Setter cleared' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not change setter' };
  }
}

/**
 * Hands a whole filtered list to one person.
 *
 * 432 of the 592 rows the tracker brought across name no setter, and about 330
 * of those are live conversations - 33 of them with a call already booked. One
 * at a time that is an afternoon of clicking, which means in practice it does
 * not happen and two thirds of the pipeline belongs to nobody.
 *
 * Same rule as claiming one: a lead a setter is already working is never taken
 * off them, even when it is inside the selection. A lead parked with an admin
 * is the imported backlog rather than somebody's work, so that one moves.
 */
export async function bulkLeadAction(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const op = field(formData, 'op') ?? 'assign';
    const leadIds = formData
      .getAll('leadId')
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (leadIds.length === 0) return { ok: false, error: 'Nothing selected' };

    // Marking a run of conversations live is the other half of handing them
    // out: everybody starts from nothing on day one, and saying so one lead
    // page at a time is the same trap as assigning one lead at a time.
    if (op === 'live' || op === 'finished') {
      const live = op === 'live';
      await db
        .update(leads)
        .set({ isActiveConvo: live, updatedAt: new Date() })
        .where(inArray(leads.id, leadIds));
      await db.insert(leadEvents).values(
        leadIds.map((leadId) => ({
          leadId,
          actorId: user.id,
          type: live ? 'convo_reopened' : 'convo_closed',
        }))
      );
      revalidatePath('/');
      revalidatePath('/leads');
      const n = leadIds.length;
      return {
        ok: true,
        message: live
          ? `${n} ${n === 1 ? 'conversation is' : 'conversations are'} marked live.`
          : `${n} ${n === 1 ? 'conversation is' : 'conversations are'} marked finished.`,
      };
    }

    const setterId = field(formData, 'setterId');
    if (!setterId) return { ok: false, error: 'Pick who they belong to' };

    // A setter can take leads, not hand them out. Only an admin decides whose
    // conversation somebody else's is.
    const me = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (me?.role !== 'admin' && setterId !== user.id) {
      return { ok: false, error: 'You can take leads, but only an admin can assign someone else.' };
    }

    const named = await db.query.users.findFirst({ where: eq(users.id, setterId) });
    if (!named) return { ok: false, error: 'No such person' };

    const rows = await db.query.leads.findMany({
      where: inArray(leads.id, leadIds),
      columns: { id: true, setterId: true },
    });

    const owners = await db.query.users.findMany({ columns: { id: true, role: true } });
    const roleById = new Map(owners.map((o) => [o.id, o.role]));

    const { moved, alreadyTheirs, leftAlone } = planBulkAssign(rows, setterId, roleById);

    if (moved.length > 0) {
      await db
        .update(leads)
        .set({ setterId, updatedAt: new Date() })
        .where(inArray(leads.id, moved));
      await db.insert(leadEvents).values(
        moved.map((leadId) => ({
          leadId,
          actorId: user.id,
          type: 'setter_changed',
          toValue: named.name,
        }))
      );
    }

    revalidatePath('/');
    revalidatePath('/leads');

    const parts = [
      moved.length === 1
        ? `1 lead is now ${named.name}'s.`
        : `${moved.length} leads are now ${named.name}'s.`,
    ];
    if (alreadyTheirs > 0) parts.push(`${alreadyTheirs} already were.`);
    if (leftAlone > 0) {
      parts.push(
        leftAlone === 1
          ? '1 was left alone \u2014 somebody else is working it.'
          : `${leftAlone} were left alone \u2014 somebody else is working them.`
      );
    }
    return { ok: true, message: parts.join(' ') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not assign those' };
  }
}

/**
 * Overrides whichever closer Calendly said was hosting. Useful when the call
 * gets handed over, or when the booking came in on a shared link.
 */
export async function setCloser(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const leadId = field(formData, 'leadId');
    const closerId = field(formData, 'closerId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    const named = closerId
      ? await db.query.users.findFirst({ where: eq(users.id, closerId) })
      : null;

    await db
      .update(leads)
      .set({
        closerId: closerId ?? null,
        // Kept in step so the card and the Discord brief don't disagree about
        // who is taking the call.
        closerName: named?.name ?? null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
    await db.insert(leadEvents).values({
      leadId,
      actorId: user.id,
      type: 'closer_changed',
      toValue: named?.name ?? null,
    });

    revalidatePath('/');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: named ? `Closer: ${named.name}` : 'Closer cleared' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not change closer' };
  }
}

/**
 * Marks a conversation live or finished. Manual rather than derived from the
 * stage: a setter knows when a thread has actually gone quiet, and a stage
 * nobody has updated in two weeks doesn't.
 */
export async function toggleActiveConvo(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const leadId = field(formData, 'leadId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead) return { ok: false, error: 'Lead not found' };

    const next = !lead.isActiveConvo;
    await db
      .update(leads)
      .set({ isActiveConvo: next, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    await db.insert(leadEvents).values({
      leadId,
      actorId: user.id,
      type: next ? 'convo_reopened' : 'convo_closed',
    });

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, message: next ? 'Marked active' : 'Marked not active' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' };
  }
}

/**
 * "I messaged them today." Moves lastOutreachAt, which is what the follow-up
 * buckets measure against - lastContactAt shifts on any edit, so it can't be
 * trusted to mean somebody actually reached out.
 *
 * Idempotent per day: pressing it twice doesn't double-count, and the button
 * reads as already done for the rest of the day.
 */
export async function markMessageSent(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const leadId = field(formData, 'leadId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead) return { ok: false, error: 'Lead not found' };

    const today = teamDateString();
    if (lead.lastOutreachAt && teamDateString(lead.lastOutreachAt) === today) {
      return { ok: true, message: 'Already logged today' };
    }

    const now = new Date();
    await db
      .update(leads)
      .set({
        lastOutreachAt: now,
        lastContactAt: now,
        followUps: sql`${leads.followUps} + 1`,
        updatedAt: now,
      })
      .where(eq(leads.id, leadId));
    await db.insert(leadEvents).values({ leadId, actorId: user.id, type: 'message_sent' });

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath('/leads/follow-ups');
    return { ok: true, message: 'Logged' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not log' };
  }
}

/** Closes a thread out from the follow-up list: it stops being active at all. */
export async function markNoFollowUp(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const leadId = field(formData, 'leadId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    await db
      .update(leads)
      .set({ isActiveConvo: false, nextFollowUpAt: null, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
    await db.insert(leadEvents).values({ leadId, actorId: user.id, type: 'no_follow_up_needed' });

    revalidatePath('/leads');
    revalidatePath('/leads/follow-ups');
    return { ok: true, message: 'Closed out' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' };
  }
}
