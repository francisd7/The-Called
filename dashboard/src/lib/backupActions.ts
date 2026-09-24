'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requireAdmin, requireUser } from './session';
import { backupIsDue, runBackup } from './backup';
import { EXPORT_ORDER, isExportKey, type ExportKey } from './exports';
import { restoreTable, type RestoreStats } from './restore';
import { recordIssue } from './issues';

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Called from the dashboard when the last backup is a week old.
 *
 * Any signed-in person can set it off, because the point is that it happens
 * without anybody being responsible for it. Nothing lands in front of whoever
 * triggered it - the files go to the COO chat.
 */
export async function backupIfDue(): Promise<Result> {
  try {
    await requireUser();
    if (!(await backupIsDue(db))) return { ok: true };

    const { ok, note } = await runBackup(db);
    if (!ok) {
      await recordIssue({
        title: 'The weekly backup did not go out',
        detail: note,
        remedy: 'Check the bot can post to the COO chat, then press Back up now on Admin.',
      });
    }
    revalidatePath('/admin');
    return ok ? { ok: true, message: note } : { ok: false, error: note };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Backup failed' };
  }
}

export async function backupNow(): Promise<Result> {
  try {
    await requireAdmin();
    const { ok, note } = await runBackup(db);
    revalidatePath('/admin');
    return ok ? { ok: true, message: `Posted to the COO chat — ${note}` } : { ok: false, error: note };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Backup failed' };
  }
}

function summarise(all: RestoreStats[], dryRun: boolean): string {
  const parts = all
    .filter((s) => s.read > 0)
    .map((s) => {
      const bits = [`${s.table}: ${s.inserted} ${dryRun ? 'would be added' : 'added'}`];
      if (s.skipped > 0) bits.push(`${s.skipped} already here`);
      if (s.overwritten > 0) bits.push(`${s.overwritten} overwritten`);
      return bits.join(', ');
    });
  const problems = all.flatMap((s) => s.problems);
  if (parts.length === 0) return problems.join(' ') || 'Nothing in the files.';
  return [parts.join(' · '), ...problems].join(' — ');
}

/**
 * Puts backup files back.
 *
 * Takes all five at once and applies them in the order the foreign keys need,
 * so a full restore is one action rather than five done in the right sequence
 * by somebody reading instructions during an outage.
 */
export async function restoreFromFiles(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const dryRun = formData.get('dryRun') === '1';
    const overwrite = formData.get('overwrite') === '1';

    const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { ok: false, error: 'Pick at least one backup file' };

    // Match each file to a table by the name the export gave it, so the order
    // they were selected in does not matter.
    const byTable = new Map<ExportKey, string>();
    const unmatched: string[] = [];
    for (const file of files) {
      const key = EXPORT_ORDER.find((k) => file.name.includes(k === 'post-call' ? 'post-call' : k));
      if (!key || !isExportKey(key)) {
        unmatched.push(file.name);
        continue;
      }
      byTable.set(key, await file.text());
    }
    if (byTable.size === 0) {
      return {
        ok: false,
        error: `Could not tell what these files are: ${unmatched.join(', ')}. Use the names they were downloaded with.`,
      };
    }

    const all: RestoreStats[] = [];
    for (const key of EXPORT_ORDER) {
      const text = byTable.get(key);
      if (text) all.push(await restoreTable(db, key, text, { overwrite, dryRun }));
    }

    revalidatePath('/admin');
    revalidatePath('/');
    const message = summarise(all, dryRun);
    return { ok: true, message: dryRun ? `Dry run — ${message}` : message };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Restore failed' };
  }
}
