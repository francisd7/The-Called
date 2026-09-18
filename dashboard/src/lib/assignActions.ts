'use server';

import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { leadEvents, leads, users } from '@/db/schema';
import { teamDateString } from './dates';

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  return { id: session.user.id, name: session.user.name ?? 'Someone' };
}

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
