'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/db';
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
