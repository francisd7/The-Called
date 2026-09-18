'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { leadEvents, leadNotes, leads, postCallReports, users } from '@/db/schema';
import { applyToLead, slug, syncPostCallReports } from './postCall';
import { normalizeIgHandle } from './calendly';
import { recordIssue } from './issues';

type Result = { ok: true; message?: string } | { ok: false; error: string };

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

function refresh() {
  revalidatePath('/');
  revalidatePath('/leads');
  revalidatePath('/kpis');
  revalidatePath('/admin');
}

/** Pulls anything new out of the Airtable form. Safe to run as often as you like. */
export async function syncPostCall(): Promise<Result> {
  try {
    await requireUser();
    const pat = process.env.AIRTABLE_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'AIRTABLE_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const stats = await syncPostCallReports(db, { pat });
    refresh();

    const parts = [`${stats.loaded} report${stats.loaded === 1 ? '' : 's'} read`];
    if (stats.added > 0) parts.push(`${stats.added} new`);
    if (stats.changed > 0) parts.push(`${stats.changed} edited in Airtable`);
    if (stats.reapplied > 0) parts.push(`${stats.reapplied} re-applied to a lead`);
    parts.push(`${stats.pending} waiting to be linked`);
    return { ok: true, message: parts.join(' · ') };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Sync failed';
    await recordIssue({
      title: 'Post-call sync failed',
      detail: error,
      remedy: 'Check AIRTABLE_PAT is set and still has access to the Post Call table.',
    });
    return { ok: false, error };
  }
}

export type LeadMatch = {
  id: string;
  igHandle: string;
  name: string | null;
  setterName: string | null;
  stage: string | null;
  callBooked: boolean;
  callScheduledFor: Date | null;
  hasOutcome: boolean;
  lastContactAt: Date | null;
};

/**
 * Finds the conversation a report belongs to.
 *
 * Handle first, because that is what a setter actually knows the person by, but
 * name and email match too - a report carries a first name, and sometimes that
 * is the only thing anybody can go on.
 */
export async function searchLeadsForReport(query: string): Promise<LeadMatch[]> {
  try {
    await requireUser();
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (q.length < 2) return [];
    const like = `%${q}%`;

    const rows = await db
      .select({
        id: leads.id,
        igHandle: leads.igHandle,
        name: leads.name,
        setterName: users.name,
        stage: leads.conversationStage,
        callBooked: leads.callBooked,
        callScheduledFor: leads.callScheduledFor,
        outcomeLoggedAt: leads.outcomeLoggedAt,
        lastContactAt: leads.lastContactAt,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.setterId))
      .where(
        and(
          eq(leads.isTest, false),
          or(
            sql`LOWER(${leads.igHandle}) LIKE ${like}`,
            sql`${leads.igHandleKey} LIKE ${like}`,
            sql`LOWER(${leads.name}) LIKE ${like}`,
            sql`LOWER(${leads.email}) LIKE ${like}`
          )
        )
      )
      // A booked call first: a post-call report is about somebody who had one,
      // so those are far likelier to be the row being looked for.
      .orderBy(desc(leads.callBooked), desc(leads.lastContactAt))
      .limit(12);

    return rows.map((r) => ({
      id: r.id,
      igHandle: r.igHandle,
      name: r.name,
      setterName: r.setterName,
      stage: r.stage,
      callBooked: r.callBooked,
      callScheduledFor: r.callScheduledFor,
      hasOutcome: r.outcomeLoggedAt !== null,
      lastContactAt: r.lastContactAt,
    }));
  } catch {
    return [];
  }
}

/**
 * Removes a lead this report created, once the report has been pointed at the
 * real conversation instead. Only ever touches a lead the app invented, and
 * only while nobody has added anything to it.
 */
async function dropCreatedLead(leadId: string): Promise<boolean> {
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
    columns: { id: true, needsHandle: true, airtableRecordId: true },
  });
  if (!lead || !lead.needsHandle || lead.airtableRecordId) return false;

  const [{ n }] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(leadNotes)
    .where(eq(leadNotes.leadId, leadId));
  if (n > 0) return false;

  await db.delete(leadEvents).where(eq(leadEvents.leadId, leadId));
  await db.delete(leads).where(eq(leads.id, leadId));
  return true;
}

export async function linkReportToLead(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const reportId = str(formData, 'reportId');
    const leadId = str(formData, 'leadId');
    if (!reportId || !leadId) return { ok: false, error: 'Pick a lead first' };

    const report = await db.query.postCallReports.findFirst({
      where: eq(postCallReports.id, reportId),
    });
    if (!report) return { ok: false, error: 'Report not found' };

    const alreadyOn = await db.query.postCallReports.findFirst({
      where: and(
        eq(postCallReports.leadId, leadId),
        eq(postCallReports.status, 'linked'),
        ne(postCallReports.id, reportId)
      ),
      columns: { leadName: true },
    });
    if (alreadyOn) {
      return {
        ok: false,
        error: `That lead already has the report for ${alreadyOn.leadName} on it. Unlink that one first.`,
      };
    }

    // Pointed somewhere new? The placeholder it used to sit on only ever
    // existed to hold it, so it goes too. Releasing the old lead's claim on the
    // report is `applyToLead`'s job.
    let dropped = false;
    if (report.leadWasCreated && report.leadId && report.leadId !== leadId) {
      dropped = await dropCreatedLead(report.leadId);
    }

    await applyToLead(db, { report, leadId, actorId: user.id });

    await db
      .update(postCallReports)
      .set({
        status: 'linked',
        leadId,
        leadWasCreated: false,
        linkedById: user.id,
        linkedAt: new Date(),
      })
      .where(eq(postCallReports.id, reportId));

    refresh();
    revalidatePath(`/leads/${leadId}`);
    return {
      ok: true,
      message: dropped ? 'Linked, and the placeholder lead was removed' : 'Linked',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not link' };
  }
}

/**
 * For a call that was never in the tracker at all - booked outside a DM, or by
 * a setter who never entered it. The lead is created from what the report knows
 * and flagged as needing a handle, rather than given an invented one.
 */
export async function createLeadFromReport(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const reportId = str(formData, 'reportId');
    if (!reportId) return { ok: false, error: 'Missing report' };

    const report = await db.query.postCallReports.findFirst({
      where: eq(postCallReports.id, reportId),
    });
    if (!report) return { ok: false, error: 'Report not found' };
    if (report.status === 'linked' && report.leadId) {
      return { ok: false, error: 'This report is already on a lead' };
    }

    const handle = str(formData, 'igHandle');
    const setterId = report.setterName
      ? ((
          await db.query.users.findFirst({
            where: sql`LOWER(${users.name}) = ${report.setterName.toLowerCase()}`,
            columns: { id: true },
          })
        )?.id ?? null)
      : null;

    const [created] = await db
      .insert(leads)
      .values({
        igHandle: handle ?? report.leadName,
        igHandleKey: handle ? normalizeIgHandle(handle) : slug(report.leadName),
        name: report.leadName,
        needsHandle: !handle,
        setterId,
        conversationStage: 'business_talk',
        responded: true,
        // Rapport carries on after a call, so this is a live conversation.
        isActiveConvo: true,
        leadCreatedAt: report.callDate ?? new Date(),
        lastContactAt: report.callDate,
      })
      .returning({ id: leads.id });

    await db.insert(leadEvents).values({
      leadId: created.id,
      actorId: user.id,
      type: 'created',
      meta: { source: 'post_call_report' } as never,
    });

    await applyToLead(db, { report, leadId: created.id, actorId: user.id });

    await db
      .update(postCallReports)
      .set({
        status: 'linked',
        leadId: created.id,
        leadWasCreated: true,
        linkedById: user.id,
        linkedAt: new Date(),
      })
      .where(eq(postCallReports.id, reportId));

    refresh();
    return { ok: true, message: `Added ${report.leadName} as a new lead` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create the lead' };
  }
}

/**
 * Puts a report back in the queue - for one that went on the wrong lead, or one
 * of the placeholder leads an earlier version of this import created.
 *
 * A placeholder goes with it, since it only ever existed to hold this report.
 * A real lead keeps what was written on it: somebody may have corrected the
 * outcome by hand since, and silently wiping that would be worse than leaving
 * a figure to be cleared deliberately.
 */
export async function unlinkReport(formData: FormData): Promise<Result> {
  try {
    await requireUser();
    const reportId = str(formData, 'reportId');
    if (!reportId) return { ok: false, error: 'Missing report' };

    const report = await db.query.postCallReports.findFirst({
      where: eq(postCallReports.id, reportId),
    });
    if (!report) return { ok: false, error: 'Report not found' };

    const dropped =
      report.leadWasCreated && report.leadId ? await dropCreatedLead(report.leadId) : false;

    await db
      .update(postCallReports)
      .set({ status: 'pending', leadId: null, leadWasCreated: false, linkedAt: null })
      .where(eq(postCallReports.id, reportId));

    refresh();
    return {
      ok: true,
      message: dropped
        ? 'Back in the queue, and the placeholder lead went with it.'
        : 'Back in the queue. The outcome stays on the lead it was on — clear it there if it was wrong.',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not unlink' };
  }
}

/** For a test submission or a duplicate - out of the queue, still on record. */
export async function setReportIgnored(formData: FormData): Promise<Result> {
  try {
    await requireUser();
    const reportId = str(formData, 'reportId');
    const ignored = formData.get('ignored') === '1';
    if (!reportId) return { ok: false, error: 'Missing report' };

    await db
      .update(postCallReports)
      .set({ status: ignored ? 'ignored' : 'pending' })
      .where(eq(postCallReports.id, reportId));

    refresh();
    return { ok: true, message: ignored ? 'Set aside' : 'Back in the queue' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' };
  }
}
