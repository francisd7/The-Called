'use server';

import { revalidatePath } from 'next/cache';
import { asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { leadEvents, leadNotes, leads, offers, users } from '@/db/schema';
import { teamDateString } from './dates';
import { importAirtableLeads } from './airtableImport';
import { setupCalendly } from './calendlySetup';

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

