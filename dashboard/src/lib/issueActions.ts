'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { requireAdmin, requireUser } from './session';
import { db } from '@/db';
import { appIssues } from '@/db/schema';

type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function reportProblem(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();

    const title = (formData.get('title') as string | null)?.trim();
    const detail = (formData.get('detail') as string | null)?.trim();
    if (!title) return { ok: false, error: 'Say what went wrong' };

    await db.insert(appIssues).values({
      kind: 'report',
      title,
      detail: detail || null,
      reportedById: user.id,
      // The page they were on when they hit it, so it doesn't have to be
      // described from memory.
      context: { from: (formData.get('from') as string | null) ?? null } as never,
    });

    revalidatePath('/admin');
    revalidatePath('/');
    return { ok: true, message: "Sent to Francis. Thanks — he'll see it on the Admin page." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not send' };
  }
}

export async function resolveIssue(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();

    const id = formData.get('id') as string | null;
    if (!id) return { ok: false, error: 'Missing issue' };

    await db
      .update(appIssues)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(appIssues.id, id));

    revalidatePath('/admin');
    return { ok: true, message: 'Marked resolved' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' };
  }
}
