import { ActionForm } from '@/components/ActionForm';
import { saveFocus } from '@/lib/planActions';
import type { focuses } from '@/db/schema';

type Focus = typeof focuses.$inferSelect;

export function FocusPanel({
  title,
  scope,
  focus,
  placeholder,
  others,
  ownerNames,
}: {
  title: string;
  scope: 'team' | 'mine';
  focus: Focus | null;
  placeholder: string;
  others?: Focus[];
  ownerNames?: Map<string, string>;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
      </div>

      <ActionForm action={saveFocus} successMessage="Saved">
        <input type="hidden" name="scope" value={scope} />
        <textarea
          name="body"
          defaultValue={focus?.body ?? ''}
          placeholder={placeholder}
          rows={3}
        />
        <div className="card-row">
          <button type="submit">{focus ? 'Update' : 'Set focus'}</button>
        </div>
      </ActionForm>

      {others && others.length > 0 && (
        <div className="focus-others">
          {others.map((o) => (
            <div key={o.id} className="focus-other">
              <div className="note-meta">{o.ownerId ? (ownerNames?.get(o.ownerId) ?? 'Someone') : 'Team'}</div>
              <div className="note-body">{o.body}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
