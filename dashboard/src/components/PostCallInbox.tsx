'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  createLeadFromReport,
  linkReportToLead,
  searchLeadsForReport,
  setReportIgnored,
  syncPostCall,
  type LeadMatch,
} from '@/lib/postCallActions';
import type { postCallReports } from '@/db/schema';

type Report = typeof postCallReports.$inferSelect;

const OUTCOME_LABELS: Record<string, string> = {
  closed: 'Closed',
  no_close: 'No close',
  no_show: 'No show',
  rescheduled: 'Rescheduled',
  follow_up_scheduled: 'Follow up scheduled',
};

function outcomeTone(outcome: string | null) {
  if (outcome === 'closed') return 'ok';
  if (outcome === 'no_show') return 'danger';
  return 'warn';
}

function money(n: string | null) {
  if (!n) return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return null;
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function dayLabel(d: Date | null) {
  if (!d) return 'no date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The link picker. Opens with the report's first name already typed, because
 * that is the one thing the form does tell us, then gets out of the way.
 */
function LinkDialog({ report, onDone }: { report: Report; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(report.leadName.split(' ')[0] ?? '');
  const [results, setResults] = useState<LeadMatch[]>([]);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Debounced so typing a handle doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      startSearch(async () => setResults(await searchLeadsForReport(query)));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const close = () => {
    ref.current?.close();
    onDone();
  };

  const submit = (fn: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) => {
    setError(null);
    startSave(async () => {
      const res = await fn(fd);
      if (res.ok) close();
      else setError(res.error ?? 'Failed');
    });
  };

  const link = (leadId: string) => {
    const fd = new FormData();
    fd.set('reportId', report.id);
    fd.set('leadId', leadId);
    submit(linkReportToLead as never, fd);
  };

  const createNew = () => {
    const fd = new FormData();
    fd.set('reportId', report.id);
    if (query.trim() && query.trim().toLowerCase() !== report.leadName.toLowerCase()) {
      fd.set('igHandle', query.trim());
    }
    submit(createLeadFromReport as never, fd);
  };

  return (
    <dialog
      ref={ref}
      className="filter-dialog"
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      onClose={onDone}
    >
      <div className="filter-dialog-inner">
        <div className="panel-head">
          <h3>Who was {report.leadName}?</h3>
          <button type="button" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        <div className="field">
          <label htmlFor="pc-search">Search the tracker</label>
          <input
            id="pc-search"
            value={query}
            autoFocus
            placeholder="@handle, name or email"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {query.trim().length < 2 ? (
            <p className="sub">Type at least two characters.</p>
          ) : searching && results.length === 0 ? (
            <p className="sub">Searching…</p>
          ) : results.length === 0 ? (
            <p className="sub">No lead matches that.</p>
          ) : (
            <ul className="pick-list">
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" className="pick" onClick={() => link(m.id)}>
                    <span className="pick-main">
                      <span className="pick-handle">@{m.igHandle}</span>
                      {m.name && <span className="pick-name">{m.name}</span>}
                    </span>
                    <span className="pick-meta">
                      {/* The call's own date is the strongest confirmation
                          there is that this is the right person: a report
                          filled in on the 16th belongs to a call on the 16th. */}
                      {m.callScheduledFor ? (
                        <span className="pill ok">call {dayLabel(m.callScheduledFor)}</span>
                      ) : (
                        m.callBooked && <span className="pill ok">booked</span>
                      )}
                      {m.hasOutcome && <span className="pill warn">has an outcome</span>}
                      {m.setterName && <span className="pill">{m.setterName}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="panel-divider" />
          <p className="sub">
            Not in the tracker? That happens when a setter never entered the conversation, or the
            call was booked outside a DM.
          </p>
          <button type="button" onClick={createNew}>
            Add {report.leadName} as a new lead
          </button>
        </fieldset>

        {error && <p className="msg err">{error}</p>}
      </div>
    </dialog>
  );
}

function ReportCard({ report }: { report: Report }) {
  const [picking, setPicking] = useState(false);
  const [busy, start] = useTransition();
  const cash = money(report.cashCollected);
  const contract = money(report.contractValue);

  return (
    <div className="tile tone-violet">
      <div className="tile-top">
        <span className="tile-when">{dayLabel(report.callDate)}</span>
        <span className={`pill ${outcomeTone(report.outcome)}`}>
          {report.outcome ? (OUTCOME_LABELS[report.outcome] ?? report.outcome) : 'no outcome'}
        </span>
      </div>

      <div className="tile-title">{report.leadName}</div>
      <div className="tile-sub">
        {[report.closerName && `Closer: ${report.closerName}`, report.setterName && `Set by ${report.setterName}`]
          .filter(Boolean)
          .join(' · ') || 'No closer recorded'}
      </div>

      {(cash || contract) && (
        <div className="tile-state">
          {contract && <span className="pill ok">{contract} contract</span>}
          {cash && <span className="pill ok">{cash} cash</span>}
        </div>
      )}

      {report.notes && <p className="tile-notes">{report.notes}</p>}

      <div className="tile-actions">
        <button type="button" className="btn-primary" onClick={() => setPicking(true)}>
          Link to lead
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const fd = new FormData();
            fd.set('reportId', report.id);
            fd.set('ignored', '1');
            start(async () => {
              await setReportIgnored(fd);
            });
          }}
        >
          Set aside
        </button>
      </div>

      {picking && <LinkDialog report={report} onDone={() => setPicking(false)} />}
    </div>
  );
}

/**
 * Post-call forms waiting to be placed.
 *
 * It looks for new ones itself when what's on screen has gone stale, so a
 * report a closer fills in shows up here without anybody having to remember a
 * button exists.
 */
export function PostCallInbox({
  reports,
  staleMinutes,
}: {
  reports: Report[];
  staleMinutes: number;
}) {
  const [checked, setChecked] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    if (checked || staleMinutes < 10) return;
    setChecked(true);
    start(async () => {
      await syncPostCall();
    });
  }, [checked, staleMinutes]);

  if (reports.length === 0) return null;

  return (
    <>
      <h2>Post-call reports to link</h2>
      <p className="sub">
        {reports.length} call{reports.length === 1 ? '' : 's'} came back from the closers&apos; form
        without anyone saying who it was about. The form only asks for a first name, so it can&apos;t
        be matched automatically — search the handle and the outcome, the cash and the booking all
        land on that lead. Until these are placed, the funnel and the money are short.
      </p>
      <div className="tile-grid">
        {reports.map((r) => (
          <ReportCard key={r.id} report={r} />
        ))}
      </div>
    </>
  );
}
