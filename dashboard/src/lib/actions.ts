'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { eodReports, leadEvents, leadNotes, leads } from '@/db/schema';
import { notifyEodSubmitted, notifyTriage } from './discord';
import { getStreaks } from './streaks';
import { recordIssue } from './issues';
import { normalizeIgHandle } from './calendly';
import { teamDateString } from './dates';

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Every action goes through this. Server actions are reachable by anyone who
 * can guess the endpoint, so the session is re-checked here rather than trusted
 * from whatever page rendered the form.
 */
async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  return { id: session.user.id, name: session.user.name ?? 'Someone', role: session.user.role };
}

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function confirmLead(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = str(formData, 'leadId');
    const method = str(formData, 'method');
    if (!leadId) return { ok: false, error: 'Missing lead' };
    if (method !== 'dm' && method !== 'phone') return { ok: false, error: 'Invalid method' };

    await db
      .update(leads)
      .set({
        confirmed: true,
        confirmedAt: new Date(),
        confirmedById: user.id,
        confirmationMethod: method,
        lastContactAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    await db.insert(leadEvents).values({
      leadId,
      actorId: user.id,
      type: 'confirmed',
      toValue: method,
    });

    revalidatePath('/');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function unconfirmLead(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = str(formData, 'leadId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    await db
      .update(leads)
      .set({
        confirmed: false,
        confirmedAt: null,
        confirmedById: null,
        confirmationMethod: null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    await db.insert(leadEvents).values({ leadId, actorId: user.id, type: 'unconfirmed' });
    revalidatePath('/');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

/**
 * Saving triage notes is what pushes the pre-call brief into Discord. That's
 * deliberate: it's how Nigel and Andrew get the notes without a dashboard
 * login, matching how pre-call notes already reach them today.
 */
export async function saveTriage(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = str(formData, 'leadId');
    const notes = str(formData, 'triageNotes');
    if (!leadId) return { ok: false, error: 'Missing lead' };
    if (!notes) return { ok: false, error: 'Write the notes before marking this triaged' };

    const [updated] = await db
      .update(leads)
      .set({
        triaged: true,
        triagedAt: new Date(),
        triagedById: user.id,
        triageNotes: notes,
        lastContactAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
      .returning();

    await db.insert(leadEvents).values({ leadId, actorId: user.id, type: 'triaged' });

    // A test lead rehearses the flow; it must not put a brief for a call that
    // doesn't exist in front of the closers.
    if (updated.isTest) {
      revalidatePath('/');
      revalidatePath(`/leads/${leadId}`);
      return { ok: true, message: 'Triaged. No Discord post — this is a test lead.' };
    }

    // A Discord outage must not cost the setter their notes, so the send is
    // reported rather than thrown.
    const sent = await notifyTriage(updated, user.name);
    if (!sent) {
      await db.insert(leadEvents).values({
        leadId,
        actorId: user.id,
        type: 'triage_notify_failed',
      });
      await recordIssue({
        title: 'Triage notes are not reaching Discord',
        detail: 'Notes saved, but the pre-call brief could not be posted. Closers are not being briefed.',
        remedy:
          'Check DISCORD_BOT_TOKEN and DISCORD_TRIAGE_CHANNEL_ID in Railway, and that the bot can see that channel.',
      });
    }

    revalidatePath('/');
    revalidatePath(`/leads/${leadId}`);
    return sent
      ? { ok: true }
      : { ok: false, error: 'Triage saved, but the Discord post failed — send it manually.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function addNote(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = str(formData, 'leadId');
    const body = str(formData, 'body');
    if (!leadId || !body) return { ok: false, error: 'Nothing to save' };

    await db.insert(leadNotes).values({ leadId, authorId: user.id, body });
    await db
      .update(leads)
      .set({ lastContactAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, leadId));

    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

/** Bumps the follow-up counter and stamps contact - the one-tap daily action. */
export async function logFollowUp(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = str(formData, 'leadId');
    const nextAt = str(formData, 'nextFollowUpAt');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    await db
      .update(leads)
      .set({
        followUps: sql`${leads.followUps} + 1`,
        lastContactAt: new Date(),
        nextFollowUpAt: nextAt ? new Date(nextAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    await db.insert(leadEvents).values({ leadId, actorId: user.id, type: 'follow_up' });
    revalidatePath('/');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function updateLead(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const leadId = str(formData, 'leadId');
    if (!leadId) return { ok: false, error: 'Missing lead' };

    const before = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!before) return { ok: false, error: 'Lead not found' };

    const igHandle = str(formData, 'igHandle');
    const stage = str(formData, 'conversationStage');
    const nextAt = str(formData, 'nextFollowUpAt');

    await db
      .update(leads)
      .set({
        ...(igHandle ? { igHandle, igHandleKey: normalizeIgHandle(igHandle) } : {}),
        name: str(formData, 'name'),
        email: str(formData, 'email')?.toLowerCase() ?? null,
        phone: str(formData, 'phone'),
        conversationStage: stage,
        leadQuality: str(formData, 'leadQuality'),
        leadSource: str(formData, 'leadSource'),
        icp: str(formData, 'icp'),
        setterId: str(formData, 'setterId'),
        nextFollowUpAt: nextAt ? new Date(nextAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    // Only stage transitions are worth a timeline entry; logging every keystroke
    // on every field would bury them.
    if (stage && stage !== before.conversationStage) {
      await db.insert(leadEvents).values({
        leadId,
        actorId: user.id,
        type: 'stage_change',
        fromValue: before.conversationStage,
        toValue: stage,
      });
    }

    revalidatePath('/');
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function createLead(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const igHandle = str(formData, 'igHandle');
    if (!igHandle) return { ok: false, error: 'An IG handle is required' };

    const [row] = await db
      .insert(leads)
      .values({
        igHandle,
        igHandleKey: normalizeIgHandle(igHandle),
        leadSource: str(formData, 'leadSource'),
        opener: str(formData, 'opener'),
        leadQuality: str(formData, 'leadQuality'),
        icp: str(formData, 'icp'),
        conversationStage: str(formData, 'conversationStage') ?? 'outreached',
        setterId: str(formData, 'setterId') ?? user.id,
        // A lead you just created is a conversation you're having.
        isActiveConvo: true,
        leadCreatedAt: new Date(),
        lastContactAt: new Date(),
      })
      .returning({ id: leads.id });

    await db.insert(leadEvents).values({ leadId: row.id, actorId: user.id, type: 'created' });
    revalidatePath('/leads');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}

export async function saveEodReport(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const reportDate = str(formData, 'reportDate') ?? teamDateString();

    const int = (key: string) => {
      const raw = str(formData, key);
      if (raw === null) return null;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    };
    const money = (key: string) => {
      const raw = str(formData, key);
      if (raw === null) return null;
      const n = Number.parseFloat(raw.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n.toFixed(2) : null;
    };

    const values = {
      userId: user.id,
      reportDate,
      totalOutbounds: int('totalOutbounds'),
      totalFollowUps: int('totalFollowUps'),
      totalLeadsWithReplies: int('totalLeadsWithReplies'),
      youtubeVideosSent: int('youtubeVideosSent'),
      callsPitched: int('callsPitched'),
      callsBooked: int('callsBooked'),
      cashCollected: money('cashCollected'),
      revenueGenerated: money('revenueGenerated'),
      win: str(formData, 'win'),
      obstacle: str(formData, 'obstacle'),
      focusTomorrow: str(formData, 'focusTomorrow'),
      notes: str(formData, 'notes'),
      updatedAt: new Date(),
    };

    // One report per person per day - resubmitting edits it rather than
    // stacking a second row for the same day.
    const existing = await db.query.eodReports.findFirst({
      where: and(eq(eodReports.userId, user.id), eq(eodReports.reportDate, reportDate)),
      columns: { id: true },
    });

    await db
      .insert(eodReports)
      .values(values)
      .onConflictDoUpdate({
        target: [eodReports.userId, eodReports.reportDate],
        set: values,
      });

    // Replaces the notification the automation hub posts when an EOD lands in
    // Airtable. Filing here instead would otherwise end that signal silently.
    const streaks = await getStreaks();
    const mine = streaks.find((s) => s.userId === user.id);
    const sent = await notifyEodSubmitted({
      setterName: user.name,
      reportDate,
      outbounds: values.totalOutbounds,
      followUps: values.totalFollowUps,
      replies: values.totalLeadsWithReplies,
      callsBooked: values.callsBooked,
      win: values.win,
      obstacle: values.obstacle,
      streakDays: mine?.eod.current ?? 0,
      isUpdate: Boolean(existing),
    });

    if (!sent) {
      await recordIssue({
        title: 'EOD reports are not reaching Discord',
        detail: 'A report saved, but the team notification could not be posted.',
        remedy:
          'Check DISCORD_BOT_TOKEN and DISCORD_SETTER_CHANNEL_ID in Railway, and that the bot can see that channel.',
      });
    }

    revalidatePath('/eod');
    return {
      ok: true,
      message: sent
        ? `Saved and posted to Discord.${(mine?.eod.current ?? 0) > 1 ? ` ${mine?.eod.current} days in a row.` : ''}`
        : 'Saved, but the Discord post failed — let the team know manually.',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed' };
  }
}
