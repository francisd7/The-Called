'use client';

import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import { ActionForm } from '@/components/ActionForm';
import { reportProblem } from '@/lib/issueActions';

/**
 * Always in the header, so reporting something broken never depends on finding
 * the right page first - which is exactly what someone can't do when a page is
 * the thing that's broken.
 */
export function ReportProblem() {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  return (
    <>
      <button type="button" className="report-btn" onClick={() => ref.current?.showModal()}>
        Report a problem
      </button>

      <dialog
        ref={ref}
        className="filter-dialog"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="filter-dialog-inner">
          <div className="panel-head">
            <h3>Report a problem</h3>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close">
              ×
            </button>
          </div>
          <p className="sub" style={{ marginTop: 0 }}>
            Goes straight to Francis. Say what you were trying to do and what happened instead.
          </p>
          <ActionForm action={reportProblem} successMessage="Sent">
            <input type="hidden" name="from" value={pathname} />
            <div className="field">
              <label htmlFor="issue-title">What went wrong *</label>
              <input id="issue-title" name="title" required placeholder="Short version" />
            </div>
            <div className="field">
              <label htmlFor="issue-detail">Any detail</label>
              <textarea
                id="issue-detail"
                name="detail"
                rows={4}
                placeholder="What you clicked, what you expected, what you got."
              />
            </div>
            <div className="card-row">
              <button className="btn-primary" type="submit">
                Send
              </button>
            </div>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}
