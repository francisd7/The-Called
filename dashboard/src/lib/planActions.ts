'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { focuses, todos } from '@/db/schema';
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

export async function addTodo(formData: FormData): Promise<Result> {
  try {
    const user = await requireUser();
    const title = field(formData, 'title');
    if (!title) return { ok: false, error: 'Write the task first' };

    // "team" is the shared list; anything else is that person's own.
    const scope = field(formData, 'scope');
    const ownerId = scope === 'team' ? null : user.id;

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
    // Someone else's personal list is theirs.
    if (todo.ownerId && todo.ownerId !== user.id && user.role !== 'admin') {
      return { ok: false, error: "That's on someone else's list" };
    }

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

    const todo = await db.query.todos.findFirst({ where: eq(todos.id, id) });
    if (!todo) return { ok: true };
    if (todo.ownerId && todo.ownerId !== user.id && user.role !== 'admin') {
      return { ok: false, error: "That's on someone else's list" };
    }

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
    const scope = field(formData, 'scope');
    const isTeam = scope === 'team';
    const ownerId = isTeam ? null : user.id;
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
