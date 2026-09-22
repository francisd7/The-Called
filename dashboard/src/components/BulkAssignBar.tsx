'use client';

import { useRef, useState } from 'react';

type Person = { id: string; name: string };

/**
 * The controls above a selectable lead table.
 *
 * Counting and select-all read the tick boxes out of the DOM rather than
 * holding a copy of the selection in state. The boxes are plain inputs inside
 * the same form - that is what the server action reads - so mirroring them
 * here would mean two sources of truth for one answer, and the one the button
 * actually submits is the DOM's.
 */
export function BulkAssignBar({
  setters,
  canAssignOthers,
  meId,
  total,
}: {
  setters: Person[];
  /** Admins hand leads out; everyone else can only take them. */
  canAssignOthers: boolean;
  meId: string;
  /** How many rows are on the page, for the select-all label. */
  total: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState(0);

  const boxes = (): HTMLInputElement[] => {
    const form = ref.current?.closest('form');
    if (!form) return [];
    return [...form.querySelectorAll<HTMLInputElement>('input[name="leadId"]')];
  };

  const recount = () => setPicked(boxes().filter((b) => b.checked).length);

  const toggleAll = (on: boolean) => {
    for (const b of boxes()) b.checked = on;
    recount();
  };

  return (
    <div className="bulk-bar" ref={ref} onChange={recount}>
      <label className="bulk-all">
        <input
          type="checkbox"
          onChange={(e) => toggleAll(e.currentTarget.checked)}
          aria-label={`Select all ${total} on this page`}
        />
        <span>All {total} on this page</span>
      </label>

      <span className="bulk-count">
        {picked === 0 ? 'none picked' : picked === 1 ? '1 picked' : `${picked} picked`}
      </span>

      {canAssignOthers ? (
        <select name="setterId" defaultValue="" aria-label="Assign to">
          <option value="" disabled>
            Assign to…
          </option>
          {setters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="setterId" value={meId} />
      )}

      <button
        className="btn-primary"
        type="submit"
        name="op"
        value="assign"
        disabled={picked === 0}
      >
        {canAssignOthers ? 'Assign' : 'Take these'}
      </button>

      {/* The other half of a handover: everybody starts with nothing marked
          live, and saying which conversations are back on one lead page at a
          time is the same afternoon of clicking that assigning one at a time
          was. Its own submit button rather than another form, so it acts on
          the same ticked rows. */}
      <span className="bulk-sep" aria-hidden="true" />
      <button type="submit" name="op" value="live" disabled={picked === 0}>
        Mark live
      </button>
      <button type="submit" name="op" value="finished" disabled={picked === 0}>
        Mark finished
      </button>
    </div>
  );
}
