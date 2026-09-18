import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { appIssues } from '@/db/schema';

/**
 * Records something that went wrong, so a failure surfaces in the app rather
 * than only in a deploy log. Repeats of the same problem bump a counter instead
 * of filling the list.
 *
 * Deliberately never throws: this is called from catch blocks, and a logger
 * that can fail would turn a handled error into an unhandled one.
 */
export async function recordIssue(input: {
  title: string;
  detail?: string | null;
  remedy?: string | null;
  context?: unknown;
}): Promise<void> {
  try {
    const existing = await db.query.appIssues.findFirst({
      where: and(
        eq(appIssues.kind, 'error'),
        eq(appIssues.title, input.title),
        eq(appIssues.status, 'open')
      ),
    });

    if (existing) {
      await db
        .update(appIssues)
        .set({
          seenCount: sql`${appIssues.seenCount} + 1`,
          lastSeenAt: new Date(),
          detail: input.detail ?? existing.detail,
        })
        .where(eq(appIssues.id, existing.id));
      return;
    }

    await db.insert(appIssues).values({
      kind: 'error',
      title: input.title,
      detail: input.detail ?? null,
      remedy: input.remedy ?? null,
      context: (input.context ?? null) as never,
    });
  } catch (err) {
    console.error('Could not record issue:', err);
  }
}

export async function getOpenIssueCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(appIssues)
      .where(eq(appIssues.status, 'open'));
    return row?.n ?? 0;
  } catch {
    // The badge must never be the thing that breaks a page.
    return 0;
  }
}

export async function getIssues(status: 'open' | 'resolved' = 'open') {
  return db
    .select()
    .from(appIssues)
    .where(eq(appIssues.status, status))
    .orderBy(desc(appIssues.lastSeenAt))
    .limit(100);
}
