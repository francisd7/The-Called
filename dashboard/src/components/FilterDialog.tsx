'use client';

import { useRef, type ReactNode } from 'react';

/**
 * Filters live behind a button rather than across the top of the page. There
 * are enough of them now that inline controls crowded out the list they filter.
 */
export function FilterDialog({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}>
        Filters
        {activeCount > 0 && <span className="pill ok">{activeCount}</span>}
      </button>

      <dialog
        ref={ref}
        className="filter-dialog"
        // Clicking the backdrop closes it - the dialog element itself is the
        // click target when the backdrop is hit.
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="filter-dialog-inner">
          <div className="panel-head">
            <h3>Filters</h3>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close">
              ×
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
