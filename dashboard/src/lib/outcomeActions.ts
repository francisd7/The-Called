'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { requireUser } from './session';
import { db } from '@/db';
import { leadEvents, leads } from '@/db/schema';
import { notifyOutcome, outcomeIsNews } from './discord';
import { recordIssue } from './issues';

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Outcomes that mean the prospect actually turned up. */
const SHOWED = new Set(['closed', 'no_close', 'follow_up_scheduled']);

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function money(form: FormData, key: string): string | null {
  const raw = field(form, key);
  if (raw === null) return null;
  const n = Number.parseFloat(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/**
 * Records what happened on a call, on the lead itself.
 *
 * This replaces the Airtable Post Call table, which held a freeform first name
 * and so could never be tied back to a lead. Here the lead is already known,
 * so showed/closed/cash land on the right row and the funnel's bottom half
 * stops drifting.
 */
export async function logCallOutcome(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();

    const leadId = field(formData, 'leadId');
    const outcome = field(formData, 'callOutcome');
    if (!leadId) return { ok: false, error: 'Missing lead' };
    if (!outcome) return { ok: false, error: 'Pick what happened on the call' };

    const closed = outcome === 'closed';
    const cancelled = outcome === 'cancelled';
    const cash = money(formData, 'cashCollected');
    const contract = money(formData, 'contractValue');

    // A close belongs to the day the call happened, not the day somebody got
    // round to typing it up. Stamping it with now() put nine backfilled closes
    // on one afternoon and read $41,320 collected "today" - money that came in
    // over weeks. Only a close with no call behind it falls back to now.
    const before = await db.query.leads.findFirst({
      where: eq(leads.id, leadId),
      columns: { callScheduledFor: true },
    });
    const happenedOn = before?.callScheduledFor ?? new Date();

    if (closed && !contract) {
      return { ok: false, error: 'A closed call needs a contract value' };
    }

    const [updated] = await db
      .update(leads)
      .set({
        callOutcome: outcome,
        // Derived rather than asked twice: a closed or no-close call is one
        // they turned up to, and asking "did they show?" alongside "did they
        // close?" invites the two to disagree.
        showed: SHOWED.has(outcome),
        closed,
        closedDate: closed ? happenedOn : null,
        cashCollected: cash,
        contractValue: contract,
        tier: field(formData, 'tier'),
        paymentMethod: field(formData, 'paymentMethod'),
        fathomUrl: field(formData, 'fathomUrl'),
        postCallNotes: field(formData, 'postCallNotes'),
        lostReason: closed ? null : field(formData, 'lostReason'),
        // A cancelled call has to stop counting as a live booking, or it sits
        // in the numbers as a call that is still coming. Recording the word on
        // its own would leave callCancelled false and the booking on the
        // calendar as far as every count is concerned.
        callCancelled: cancelled,
        callCancelledAt: cancelled ? happenedOn : null,
        cancelReason: cancelled ? field(formData, 'cancelReason') : null,
        // isActiveConvo is deliberately untouched. Rapport carries on after a
        // call - a close becomes a client relationship, a no-close is often
        // still being worked - so the call outcome is not the team's signal for
        // whether the conversation is over. Only a person decides that.
        outcomeLoggedAt: new Date(),
        outcomeLoggedById: user.id,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
      .returning();

    if (!updated) return { ok: false, error: 'Lead not found' };

    await db.insert(leadEvents).values({
      leadId,
      actorId: user.id,
      type: 'call_outcome',
      toValue: outcome,
      meta: { cash, contract, tier: field(formData, 'tier') },
    });

    // Backfilled results stay off Discord - see outcomeIsNews. The team gets
    // told about today's calls, not about a close being typed up weeks later.
    const news = outcomeIsNews(updated);
    const sent = news ? await notifyOutcome(updated, user.name) : false;
    if (news && !sent && closed) {
      // A close nobody heard about is the one worth chasing.
      await recordIssue({
        title: 'Call outcomes are not reaching Discord',
        detail: 'An outcome saved, but the team notification could not be posted.',
        remedy:
          'Check DISCORD_BOT_TOKEN and DISCORD_SETTER_CHANNEL_ID in Railway, and that the bot can see that channel.',
      });
    }

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath(`/leads/${leadId}`);
    const saved = closed ? `Closed — $${contract} logged.` : 'Outcome saved.';
    return {
      ok: true,
      message: news ? saved : `${saved} Not posted to Discord — the call wasn't recent.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save' };
  }
}
