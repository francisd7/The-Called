'use server';

import { revalidatePath } from 'next/cache';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { calendlyEventTypes, leadEvents, leadNotes, leads, offers, users } from '@/db/schema';
import { teamDateString } from './dates';
import { importSetterEod } from './eodImport';
import { importAirtableLeads } from './airtableImport';
import { setupCalendly } from './calendlySetup';
import { backfillCalendly, discoverEventTypes } from './calendlyBackfill';

type Result = { ok: true; message: string } | { ok: false; error: string };

/**
 * These actions change production data wholesale, so they re-check the role
 * here. The admin page already redirects non-admins, but a server action is
 * reachable directly and a hidden button is not access control.
 */
async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== 'admin') throw new Error('Admins only');
}

export async function runAirtableImport(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const pat = process.env.AIRTABLE_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'AIRTABLE_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const dryRun = formData.get('dryRun') === '1';
    const stats = await importAirtableLeads(db, { pat, dryRun });

    const parts = [
      `${stats.loaded} records read`,
      `${stats.inserted} added`,
      `${stats.updated} updated`,
      `${stats.notes} notes migrated`,
    ];
    if (stats.blankHandle > 0) parts.push(`${stats.blankHandle} with no IG handle`);
    if (stats.noSetter > 0) parts.push(`${stats.noSetter} naming an unknown setter`);

    revalidatePath('/admin');
    revalidatePath('/leads');
    return {
      ok: true,
      message: `${dryRun ? 'Dry run — nothing written. ' : ''}${parts.join(' · ')}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Import failed' };
  }
}

export async function runCalendlySetup(): Promise<Result> {
  try {
    await requireAdmin();
    const pat = process.env.CALENDLY_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'CALENDLY_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const result = await setupCalendly(db, {
      pat,
      publicUrl: process.env.AUTH_URL,
      signingKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
    });

    const parts = [`Connected as ${result.account.email}`];
    parts.push(`${result.linked.length}/${result.linked.length + result.unlinked.length} offers linked`);
    if (result.unlinked.length > 0) {
      parts.push(`no Calendly match for: ${result.unlinked.map((u) => u.offer).join(', ')}`);
    }
    if (result.webhook.status === 'created') parts.push('webhook registered');
    else if (result.webhook.status === 'already_registered') parts.push('webhook already registered');
    else parts.push(`webhook skipped (${result.webhook.reason})`);

    revalidatePath('/admin');
    return { ok: true, message: parts.join(' · ') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Calendly setup failed' };
  }
}

/**
 * Creates a fake booking so the flow can be walked through end to end without
 * a real Calendly booking and without anyone being pinged about a call that
 * doesn't exist. Test leads are labelled wherever they appear, never post to
 * Discord, and are cleared in one click.
 */
export async function createTestBooking(): Promise<Result> {
  try {
    await requireAdmin();

    const offer = await db.query.offers.findFirst({ orderBy: [asc(offers.sortOrder)] });
    const setter = await db.query.users.findFirst({ where: eq(users.role, 'setter') });

    // Two hours out, so it's imminent without being in the past. Late in the
    // evening that crosses midnight ET and the booking lands under "Next 7
    // days" instead - which the message below accounts for rather than sending
    // someone to look at the wrong list.
    const scheduledFor = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const landsToday = teamDateString(scheduledFor) === teamDateString();
    const stamp = new Date().toISOString().slice(11, 16).replace(':', '');

    const [lead] = await db
      .insert(leads)
      .values({
        igHandle: `test_booking_${stamp}`,
        igHandleKey: `test_booking_${stamp}`,
        name: 'Test Prospect (not real)',
        email: `test+${stamp}@example.com`,
        phone: '+1 555 000 0000',
        setterId: setter?.id ?? null,
        conversationStage: 'call_booked',
        leadQuality: 'good',
        isTest: true,
        callBooked: true,
        callBookedAt: new Date(),
        callScheduledFor: scheduledFor,
        offerId: offer?.id ?? null,
        closerName: 'Test Closer',
        leadCreatedAt: new Date(),
        lastContactAt: new Date(),
      })
      .returning();

    await db.insert(leadNotes).values({
      leadId: lead.id,
      authorId: null,
      body:
        'This is a test lead created from the Admin screen. Confirm it, triage it, ' +
        'add notes — nothing here reaches Discord, and Admin has a button to delete it.',
    });
    await db.insert(leadEvents).values({ leadId: lead.id, type: 'call_booked', meta: { test: true } });

    revalidatePath('/');
    revalidatePath('/admin');
    const when = scheduledFor.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    return {
      ok: true,
      message: landsToday
        ? `Test booking created for ${when} ET — see it under Today → Calls today.`
        : `Test booking created for ${when} ET tomorrow — see it under Today → Next 7 days.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not create test booking' };
  }
}

export async function clearTestData(): Promise<Result> {
  try {
    await requireAdmin();
    const removed = await db.delete(leads).where(eq(leads.isTest, true)).returning({ id: leads.id });
    revalidatePath('/');
    revalidatePath('/admin');
    revalidatePath('/leads');
    return {
      ok: true,
      message: removed.length === 0 ? 'No test leads to clear.' : `Removed ${removed.length} test lead(s).`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not clear test data' };
  }
}


/**
 * Pulls the Airtable Setter EOD form across.
 *
 * Safe to re-run: rows already brought over are updated in place, and a report
 * somebody filed in the dashboard for the same day is left exactly as it is.
 */
export async function runEodImport(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const pat = process.env.AIRTABLE_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'AIRTABLE_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const dryRun = formData.get('dryRun') === '1';
    const stats = await importSetterEod(db, { pat, dryRun });

    const parts = [`${stats.loaded} report${stats.loaded === 1 ? '' : 's'} read`];
    if (stats.inserted > 0) parts.push(`${stats.inserted} added`);
    if (stats.updated > 0) parts.push(`${stats.updated} updated`);
    if (stats.keptDashboard > 0) {
      parts.push(`${stats.keptDashboard} left alone (already filed here)`);
    }
    if (stats.skipped.length > 0) parts.push(`${stats.skipped.length} skipped`);

    revalidatePath('/eod');
    revalidatePath('/kpis');
    revalidatePath('/admin');
    return {
      ok: true,
      message: `${dryRun ? 'Dry run — nothing written. ' : ''}${parts.join(' · ')}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Import failed' };
  }
}

/**
 * Pulls every booking Calendly has taken since the team started using it.
 *
 * The webhook only hears about bookings made after it was registered, so this
 * is the only way to recover the ones that predate it - and the only source
 * anywhere for cancellations after the Airtable tracker stopped being filled in.
 */
export async function runCalendlyBackfill(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const pat = process.env.CALENDLY_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'CALENDLY_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const dryRun = formData.get('dryRun') === '1';
    const since = (formData.get('since') as string | null)?.trim();
    const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00Z` : undefined;

    // This action never removes anything - that is its own button below.
    const stats = await backfillCalendly(db, { pat, since: from, dryRun });

    const parts = [`${stats.events} booking${stats.events === 1 ? '' : 's'} read`];
    if (stats.range) parts.push(`${stats.range.from} to ${stats.range.to}`);
    if (stats.notOurs > 0) parts.push(`${stats.notOurs} skipped — not one of the three links`);
    if (stats.removed > 0) parts.push(`${stats.removed} leads removed that an earlier run invented`);
    if (stats.cleared > 0) parts.push(`${stats.cleared} real leads cleared of one`);
    if (stats.matched > 0) parts.push(`${stats.matched} matched a lead`);
    if (stats.created > 0) parts.push(`${stats.created} had no lead, so one was created`);
    if (stats.updated > 0) parts.push(`${stats.updated} already here`);
    if (stats.cancelled > 0) parts.push(`${stats.cancelled} cancelled`);
    if (stats.skipped > 0) parts.push(`${stats.skipped} had nothing to identify them`);

    // Named, so a skipped link can be recognised as a personal appointment or
    // as a sales call on a link that has since been replaced.
    const breakdown = stats.byEventType
      .map((e) => `${e.name}: ${e.count}${e.ours ? ' ✓' : ''}`)
      .join(' · ');

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath('/kpis');
    revalidatePath('/admin');
    return {
      ok: true,
      message: `${dryRun ? 'Dry run — nothing written. ' : ''}${parts.join(' · ')}${
        breakdown ? `\n\nLinks used: ${breakdown}` : ''
      }`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Backfill failed' };
  }
}

/** Finds every Calendly link with a booking on it, so they can be ticked off. */
export async function findCalendlyLinks(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const pat = process.env.CALENDLY_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'CALENDLY_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const since = (formData.get('since') as string | null)?.trim();
    const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00Z` : undefined;
    const stats = await discoverEventTypes(db, { pat, since: from });

    revalidatePath('/admin');
    const parts = [`${stats.found} link${stats.found === 1 ? '' : 's'} across ${stats.bookings} bookings`];
    if (stats.range) parts.push(`${stats.range.from} to ${stats.range.to}`);
    if (stats.added > 0) parts.push(`${stats.added} new`);
    return { ok: true, message: `${parts.join(' · ')}. Tick the ones that are sales calls.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read Calendly' };
  }
}

/**
 * Sets which links count, in one go.
 *
 * Unticked boxes aren't submitted at all, so anything missing from the form is
 * explicitly set back to not counting - otherwise a link could never be
 * un-ticked once it had been ticked.
 */
export async function saveCountedLinks(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const ticked = formData.getAll('counted').filter((v): v is string => typeof v === 'string');

    await db.update(calendlyEventTypes).set({ counted: false });
    if (ticked.length > 0) {
      await db
        .update(calendlyEventTypes)
        .set({ counted: true })
        .where(inArray(calendlyEventTypes.uri, ticked));
    }

    revalidatePath('/admin');
    return {
      ok: true,
      message:
        ticked.length === 0
          ? 'Nothing counts as a sales call — bookings will be ignored until you tick one.'
          : `${ticked.length} link${ticked.length === 1 ? '' : 's'} count as sales calls.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save' };
  }
}

/**
 * Takes back bookings that an earlier, unfiltered run wrote onto leads.
 *
 * Its own action rather than a tick-box on the import, because the two do
 * opposite things and sharing a form made it impossible to be sure which one
 * had just run.
 */
export async function runCalendlyCleanup(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const pat = process.env.CALENDLY_PAT;
    if (!pat) {
      return {
        ok: false,
        error: 'CALENDLY_PAT is not set on this service. Add it in Railway, then redeploy.',
      };
    }

    const dryRun = formData.get('dryRun') === '1';
    const since = (formData.get('since') as string | null)?.trim();
    const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00Z` : undefined;

    const stats = await backfillCalendly(db, {
      pat,
      since: from,
      dryRun,
      cleanup: true,
      apply: false,
    });

    const parts = [`${stats.notOurs} booking${stats.notOurs === 1 ? '' : 's'} on links that don't count`];
    parts.push(
      stats.removed > 0 ? `${stats.removed} invented leads removed` : 'no invented leads to remove'
    );
    if (stats.cleared > 0) parts.push(`${stats.cleared} real leads cleared of one`);

    revalidatePath('/');
    revalidatePath('/leads');
    revalidatePath('/kpis');
    revalidatePath('/admin');
    return {
      ok: true,
      message: `${dryRun ? 'Dry run — nothing written. ' : ''}${parts.join(' · ')}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cleanup failed' };
  }
}
