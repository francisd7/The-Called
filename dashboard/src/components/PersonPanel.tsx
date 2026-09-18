import { ActionForm } from '@/components/ActionForm';
import { addTodo, deleteTodo, saveFocus, toggleTodo } from '@/lib/planActions';
import { relativeDays } from '@/lib/dates';
import type { focuses } from '@/db/schema';
import type { TodoRow } from '@/lib/queries';

type Focus = typeof focuses.$inferSelect;

function isOverdue(due: string | null) {
  if (!due) return false;
  // Compared as YYYY-MM-DD against the team's today, so something due today
  // doesn't read as overdue just because it's the afternoon.
  return due < new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * One person's week in a single card: what they're focused on, and what's on
 * their list. `ownerId` null is the team's card.
 */
export function PersonPanel({
  title,
  ownerId,
  focus,
  todos,
  focusPlaceholder,
  emptyText,
  wide = false,
}: {
  title: string;
  ownerId: string | null;
  focus: Focus | null;
  todos: TodoRow[];
  focusPlaceholder: string;
  emptyText: string;
  wide?: boolean;
}) {
  const open = todos.filter((t) => !t.completedAt);
  const done = todos.filter((t) => t.completedAt);
  const scopeFields = (
    <>
      {ownerId === null ? (
        <input type="hidden" name="scope" value="team" />
      ) : (
        <input type="hidden" name="ownerId" value={ownerId} />
      )}
    </>
  );

  return (
    <section className={`panel${wide ? ' panel-wide' : ''}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="card-meta">{open.length} open</span>
      </div>

      <ActionForm action={saveFocus} successMessage="Focus saved">
        {scopeFields}
        <label htmlFor={`focus-${ownerId ?? 'team'}`}>Focus this week</label>
        <textarea
          id={`focus-${ownerId ?? 'team'}`}
          name="body"
          defaultValue={focus?.body ?? ''}
          placeholder={focusPlaceholder}
          rows={3}
        />
        <div className="card-row">
          <button type="submit">{focus ? 'Update focus' : 'Set focus'}</button>
        </div>
      </ActionForm>

      <div className="panel-divider" />

      {open.length === 0 && done.length === 0 ? (
        <p className="panel-empty">{emptyText}</p>
      ) : (
        <ul className="todos">
          {[...open, ...done].map((todo) => {
            const isDone = todo.completedAt !== null;
            return (
              <li key={todo.id} className={`todo${isDone ? ' todo-done' : ''}`}>
                <ActionForm action={toggleTodo}>
                  <input type="hidden" name="id" value={todo.id} />
                  <button type="submit" className="todo-check" aria-label="Toggle done">
                    {isDone ? '☑' : '☐'}
                  </button>
                </ActionForm>

                <div className="todo-body">
                  <span className="todo-title">{todo.title}</span>
                  <span className="todo-meta">
                    {todo.dueDate && (
                      <span className={`pill${!isDone && isOverdue(todo.dueDate) ? ' warn' : ''}`}>
                        {relativeDays(new Date(`${todo.dueDate}T12:00:00Z`))}
                      </span>
                    )}
                    {todo.leadId && todo.leadHandle && (
                      <a className="pill" href={`/leads/${todo.leadId}`}>
                        @{todo.leadHandle}
                      </a>
                    )}
                  </span>
                </div>

                <ActionForm action={deleteTodo}>
                  <input type="hidden" name="id" value={todo.id} />
                  <button type="submit" className="todo-x" aria-label="Remove">
                    ×
                  </button>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}

      <ActionForm action={addTodo} successMessage="Added" className="todo-add">
        {scopeFields}
        <input name="title" placeholder="Add a task…" required aria-label="Task" />
        <input name="dueDate" type="date" aria-label="Due date" />
        <button type="submit">Add</button>
      </ActionForm>
    </section>
  );
}
