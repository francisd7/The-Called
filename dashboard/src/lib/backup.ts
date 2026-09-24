import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema.ts';
import { backupRuns } from '../db/schema.ts';
import { buildCsv, EXPORT_ORDER, fileNameFor } from './exports.ts';
import { postFilesToChannel } from './discord.ts';

type Db = PostgresJsDatabase<typeof schema>;

/** Long enough not to be noise, short enough that a loss costs at most a week. */
export const BACKUP_EVERY_DAYS = 7;

/** The COO chat. Overridable with DISCORD_BACKUP_CHANNEL_ID. */
const COO_CHANNEL_ID = '1547339220840882306';

export async function lastBackup(db: Db) {
  const [row] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.ok, true))
    .orderBy(desc(backupRuns.ranAt))
    .limit(1);
  return row ?? null;
}

/** Days since the last one that worked, or null if there has never been one. */
export async function daysSinceBackup(db: Db): Promise<number | null> {
  const last = await lastBackup(db);
  if (!last) return null;
  return (Date.now() - last.ranAt.getTime()) / 86_400_000;
}

export async function backupIsDue(db: Db): Promise<boolean> {
  const days = await daysSinceBackup(db);
  if (days === null) return true;
  return days >= BACKUP_EVERY_DAYS;
}

/**
 * Takes a copy of everything and posts it to Discord.
 *
 * Discord rather than the disk it came from: a backup living beside the
 * database it protects is not a backup. It is also already wired up here, so
 * this needs no new account and nothing anybody has to remember to renew.
 *
 * Runs whole or not at all - a partial set posted as if it were a backup is
 * worse than a failure somebody can see.
 */
export async function runBackup(db: Db, channelId?: string): Promise<{ ok: boolean; note: string }> {
  // Defaulted rather than required: the channel id is not a secret, and a
  // backup that waits on somebody setting a Railway variable is a backup that
  // does not exist yet. The variable still wins if it is set.
  const channel = channelId ?? process.env.DISCORD_BACKUP_CHANNEL_ID ?? COO_CHANNEL_ID;
  try {
    const files = [];
    let bytes = 0;
    let rows = 0;
    for (const key of EXPORT_ORDER) {
      const body = await buildCsv(db, key);
      bytes += Buffer.byteLength(body, 'utf8');
      // Minus the header. Not exact for cells holding newlines, which is why
      // it is only ever shown as a rough size next to the byte count.
      rows += Math.max(0, body.split('\r\n').length - 2);
      files.push({ name: fileNameFor(key), body });
    }

    // Discord refuses anything over 10MB on a free server, and refusing
    // loudly here beats a post that silently never arrives.
    if (bytes > 9_000_000) {
      const note = `Too big for Discord: ${(bytes / 1e6).toFixed(1)}MB. Download from Admin instead.`;
      await db.insert(backupRuns).values({ ok: false, bytes, rows, note });
      return { ok: false, note };
    }

    const on = new Date().toISOString().slice(0, 10);
    const posted = await postFilesToChannel(
      channel,
      `🗄️ **Weekly backup** — ${on}\n${files.length} files · ~${rows.toLocaleString('en-US')} rows · ${(bytes / 1024).toFixed(0)} KB\nKeep these. Admin → Restore puts them back.`,
      files
    );

    const note = posted ? `${files.length} files posted` : 'Discord refused the upload';
    await db.insert(backupRuns).values({ ok: posted, bytes, rows, note });
    return { ok: posted, note };
  } catch (err) {
    const note = err instanceof Error ? err.message : 'Backup failed';
    await db.insert(backupRuns).values({ ok: false, note });
    return { ok: false, note };
  }
}
