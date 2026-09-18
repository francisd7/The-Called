import { ActionForm } from '@/components/ActionForm';
import { addTodo, deleteTodo, toggleTodo } from '@/lib/planActions';
import { relativeDays } from '@/lib/dates';
import type { TodoRow } from '@/lib/queries';

function dueClass(due: string | null, done: boolean) {
  if (!due || done) return '';
  // Compared as YYYY-MM-DD strings against the team's today, so a task due
  // today doesn't read as overdue just because it's the afternoon.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (due < today) return ' warn';
  return '';
}

export function TodoList({
  todos,
  scope,
  title,
  emptyText,
  showOwner = false,
}: {
  todos: TodoRow[];
  scope: 'mine' | 'team';
  title: string;
  emptyText: string;
  showOwner?: boolean;
}) {
  const open = todos.filter((t) => !t.completedAt);
  const done = todos.filter((t) => t.completedAt);

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="card-meta">{open.length} open</span>
      </div>

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
                      <span className={`pill${dueClass(todo.dueDate, isDone)}`}>
                        {relativeDays(new Date(`${todo.dueDate}T12:00:00Z`))}
                      </span>
                    )}
                    {todo.leadId && todo.leadHandle && (
                      <a className="pill" href={`/leads/${todo.leadId}`}>
                        @{todo.leadHandle}
                      </a>
                    )}
                    {showOwner && todo.ownerName && <span className="pill">{todo.ownerName}</span>}
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
        <input type="hidden" name="scope" value={scope} />
        <input name="title" placeholder="Add a task…" required aria-label="Task" />
        <input name="dueDate" type="date" aria-label="Due date" />
        <button type="submit">Add</button>
      </ActionForm>
    </section>
  );
}
