'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { focuses, todos, users } from '@/db/schema';
import { weekStart } from './dates';

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  return { id: session.user.id, name: session.user.name ?? 'Someone', role: session.user.role };
}

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Which list this is for. Everyone can see and edit everyone's, deliberately -
 * the whole point of showing the columns side by side is that Francis can hand
 * Loui a task and either setter can see what the other is carrying. At five
 * people, permissions between them would be friction with nothing behind it.
 *
 * The id is still checked against a real user rather than trusted, so a
 * hand-crafted request can't create a list owned by nobody.
 */
async function resolveOwner(form: FormData, fallbackId: string): Promise<string | null> {
  const scope = form.get('scope');
  if (scope === 'team') return null;

  const ownerId = field(form, 'ownerId');
  if (!ownerId) return fallbackId;

  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerId) });
  if (!owner) throw new Error('That person no longer exists');
  return owner.id;
}

export async function addTodo(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const title = field(formData, 'title');
    if (!title) return { ok: false, error: 'Write the task first' };

    const ownerId = await resolveOwner(formData, user.id);

    await db.insert(todos).values({
      ownerId,
      title,
      dueDate: field(formData, 'dueDate'),
      leadId: field(formData, 'leadId'),
      createdById: user.id,
    });

    revalidatePath('/');
    return { ok: true, message: 'Added' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add' };
  }
}

export async function toggleTodo(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const id = field(formData, 'id');
    if (!id) return { ok: false, error: 'Missing task' };

    const todo = await db.query.todos.findFirst({ where: eq(todos.id, id) });
    if (!todo) return { ok: false, error: 'Task not found' };

    const done = todo.completedAt !== null;
    await db
      .update(todos)
      .set({
        completedAt: done ? null : new Date(),
        completedById: done ? null : user.id,
      })
      .where(eq(todos.id, id));

    revalidatePath('/');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' };
  }
}

export async function deleteTodo(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const id = field(formData, 'id');
    if (!id) return { ok: false, error: 'Missing task' };

    await db.delete(todos).where(eq(todos.id, id));
    revalidatePath('/');
    return { ok: true, message: 'Removed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove' };
  }
}

export async function saveFocus(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const body = field(formData, 'body');
    const ownerId = await resolveOwner(formData, user.id);
    const isTeam = ownerId === null;
    const week = weekStart();

    if (!body) {
      // Clearing is a legitimate edit, not an error.
      await db
        .delete(focuses)
        .where(
          and(
            isTeam ? isNull(focuses.ownerId) : eq(focuses.ownerId, user.id),
            eq(focuses.weekOf, week)
          )
        );
      revalidatePath('/');
      return { ok: true, message: 'Cleared' };
    }

    await db
      .insert(focuses)
      .values({ ownerId, weekOf: week, body, updatedById: user.id })
      .onConflictDoUpdate({
        target: [focuses.ownerId, focuses.weekOf],
        set: { body, updatedById: user.id, updatedAt: new Date() },
      });

    revalidatePath('/');
    return { ok: true, message: 'Saved' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save' };
  }
}
