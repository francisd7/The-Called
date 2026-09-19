import { redirect } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { eodReports, leads, offers, users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { formatCallTime, formatDay } from '@/lib/dates';
import {
  getAllPostCallReports,
  getPipelineSummary,
  getRecentCalendlyActivity,
  getUnmatchedBookings,
} from '@/lib/queries';
import { getIssues } from '@/lib/issues';
import { resolveIssue } from '@/lib/issueActions';
import {
  clearTestData,
  createTestBooking,
  runAirtableImport,
  runCalendlyBackfill,
  runCalendlySetup,
  runEodImport,
} from '@/lib/setupActions';
import { syncPostCall, unlinkReport } from '@/lib/postCallActions';

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li style={{ marginBottom: '0.3rem' }}>
      <span className={`pill ${done ? 'ok' : 'warn'}`}>{done ? '✓' : '—'}</span>{' '}
      {children}
    </li>
  );
}

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  // The nav hides this link for non-admins, but the route has to enforce it
  // too - a hidden link is not access control.
  if (session?.user?.role !== 'admin') redirect('/');

  const [
    summary,
    unmatched,
    activity,
    issues,
    people,
    recentEod,
    offerRows,
    [{ leadCount }],
    reports,
  ] = await Promise.all([
    getPipelineSummary(),
    getUnmatchedBookings(),
    getRecentCalendlyActivity(),
    getIssues('open'),
    db.select().from(users).orderBy(users.name),
    db.select().from(eodReports).orderBy(desc(eodReports.reportDate)).limit(10),
    db.select().from(offers).orderBy(offers.sortOrder),
    db.select({ leadCount: count() }).from(leads),
    getAllPostCallReports(),
  ]);

  const [{ testCount }] = await db
    .select({ testCount: count() })
    .from(leads)
    .where(eq(leads.isTest, true));

  // Only people who can actually sign in need a real address. A closer seeded
  // but deliberately not set up yet isn't an outstanding task, and a checklist
  // that nags about a decision already made just teaches people to ignore it.
  const placeholderPeople = people.filter((p) => p.active && p.email.startsWith('CHANGEME'));
  const linkedOffers = offerRows.filter((o) => o.eventTypeUri).length;
  const setupComplete =
    placeholderPeople.length === 0 && linkedOffers === offerRows.length && leadCount > 0;

  return (
    <>
      <h1>Admin</h1>

      <h2>Problems{issues.length > 0 ? ` (${issues.length})` : ''}</h2>
      <p className="sub">
        Anything a setter reported, plus anything the app failed at on its own. Both land here so
        there&apos;s one place to look instead of a deploy log nobody reads.
      </p>
      {issues.length === 0 ? (
        <p className="empty">Nothing outstanding.</p>
      ) : (
        issues.map((issue) => (
          <div className="card" key={issue.id}>
            <div className="card-head">
              <strong>{issue.title}</strong>
              <span className="card-meta">
                <span className={`pill ${issue.kind === 'error' ? 'danger' : 'warn'}`}>
                  {issue.kind === 'error' ? 'app error' : 'reported'}
                </span>{' '}
                {issue.seenCount > 1 && <span className="pill">×{issue.seenCount}</span>}{' '}
                {formatCallTime(issue.lastSeenAt)}
              </span>
            </div>
            {issue.detail && (
              <div className="note-body" style={{ marginTop: '0.4rem' }}>
                {issue.detail}
              </div>
            )}
            {issue.remedy && (
              <p className="sub" style={{ marginTop: '0.5rem' }}>
                <strong>To fix:</strong> {issue.remedy}
              </p>
            )}
            {(issue.context as { from?: string } | null)?.from && (
              <p className="sub" style={{ marginTop: '0.3rem' }}>
                On page <code>{(issue.context as { from?: string }).from}</code>
              </p>
            )}
            <div className="card-row">
              <ActionForm action={resolveIssue} successMessage="Resolved">
                <input type="hidden" name="id" value={issue.id} />
                <button type="submit">Mark resolved</button>
              </ActionForm>
            </div>
          </div>
        ))
      )}

      {!setupComplete && (
        <>
          <h2>Setup</h2>
          <div className="card">
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.9rem' }}>
              <Check done>Database tables created</Check>
              <Check done={placeholderPeople.length === 0}>
                <a href="/admin/people">Real email addresses for everyone who signs in</a>
                {placeholderPeople.length > 0 && (
                  <span className="card-meta">
                    {' '}
                    — still placeholders: {placeholderPeople.map((p) => p.name).join(', ')}
                  </span>
                )}
              </Check>
              <Check done={leadCount > 0}>
                Leads imported from Airtable
                {leadCount > 0 && <span className="card-meta"> — {leadCount.toLocaleString()} in</span>}
              </Check>
              <Check done={linkedOffers === offerRows.length}>
                Calendly connected
                <span className="card-meta">
                  {' '}
                  — {linkedOffers}/{offerRows.length} offers linked
                </span>
              </Check>
            </ul>

            <div className="card-row">
              <ActionForm action={runAirtableImport}>
                <input type="hidden" name="dryRun" value="1" />
                <button type="submit">Test Airtable import</button>
              </ActionForm>
              <ActionForm action={runAirtableImport}>
                <input type="hidden" name="dryRun" value="0" />
                <button className="btn-primary" type="submit">
                  Import leads from Airtable
                </button>
              </ActionForm>
            </div>
            <p className="sub" style={{ marginTop: '0.4rem' }}>
              Safe to re-run — leads are keyed on their Airtable id, so a second run updates rather
              than duplicating. Needs <code>AIRTABLE_PAT</code> set on this service.
            </p>

            <div className="card-row">
              <ActionForm action={runCalendlySetup}>
                <button className="btn-primary" type="submit">
                  Connect Calendly
                </button>
              </ActionForm>
            </div>
            <p className="sub" style={{ marginTop: '0.4rem' }}>
              Links the three offers to their Calendly event types and registers the booking
              webhook. Needs <code>CALENDLY_PAT</code> set on this service. Won&apos;t create a
              duplicate webhook.
            </p>
          </div>
        </>
      )}

      <div className="stats">
        <div className="stat">
          <div className="stat-n">{summary.totalLeads.toLocaleString()}</div>
          <div className="stat-l">leads</div>
        </div>
        <div className="stat">
          <div className="stat-n">{summary.bookedCalls}</div>
          <div className="stat-l">live bookings</div>
        </div>
        <div className={`stat${unmatched.length > 0 ? ' alert' : ''}`}>
          <div className="stat-n">{unmatched.length}</div>
          <div className="stat-l">unmatched bookings</div>
        </div>
      </div>

      <h2>Calendly history</h2>
      <p className="sub">
        The webhook only hears about bookings made after it was registered. This pulls every booking
        Calendly has taken since the date below — cancellations included — which is the only record
        anywhere of the calls that never made it into the tracker. A booking with no lead behind it
        gets one created rather than dropped. Safe to re-run.
      </p>
      <div className="card">
        {/* One date, two buttons. A submit button's own name and value reach the
            action, so the dry run and the real thing share a single form rather
            than each carrying their own copy of the date. */}
        <ActionForm action={runCalendlyBackfill}>
          <div className="field">
            <label htmlFor="since">From</label>
            <input id="since" name="since" type="date" defaultValue="2026-06-01" />
          </div>
          <div className="card-row">
            <button type="submit" name="dryRun" value="1">
              Test Calendly backfill
            </button>
            <button className="btn-primary" type="submit" name="dryRun" value="0">
              Pull Calendly history
            </button>
          </div>
        </ActionForm>
      </div>

      <h2>Setter EOD reports</h2>
      <p className="sub">
        Pulls the Airtable Setter EOD form across. Anything already brought over is updated rather
        than duplicated, and a report somebody filed in the dashboard for the same day is left
        exactly as it is. Safe to re-run.
      </p>
      <div className="card">
        <div className="card-row">
          <ActionForm action={runEodImport}>
            <input type="hidden" name="dryRun" value="1" />
            <button type="submit">Test EOD import</button>
          </ActionForm>
          <ActionForm action={runEodImport}>
            <input type="hidden" name="dryRun" value="0" />
            <button className="btn-primary" type="submit">
              Import EOD reports
            </button>
          </ActionForm>
        </div>
      </div>

      <h2>Post-call reports</h2>
      <p className="sub">
        Every submission of the closers&apos; Airtable form, and which lead it ended up on. New ones
        show up on the dashboard waiting to be linked; the dashboard also checks for them on its
        own, so this button is only needed when you don&apos;t want to wait.
      </p>
      <div className="card">
        <div className="card-row">
          <ActionForm action={syncPostCall}>
            <button className="btn-primary" type="submit">
              Check Airtable now
            </button>
          </ActionForm>
        </div>
      </div>
      {reports.length === 0 ? (
        <p className="empty">Nothing pulled across yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Call</th>
                <th>Name</th>
                <th>Outcome</th>
                <th>Cash</th>
                <th>On</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map(({ report, leadHandle }) => (
                <tr key={report.id}>
                  <td>{formatDay(report.callDate)}</td>
                  <td>{report.leadName}</td>
                  <td>{report.outcome ?? '—'}</td>
                  <td>{report.cashCollected ? `$${report.cashCollected}` : '—'}</td>
                  <td>
                    {report.status === 'linked' && report.leadId ? (
                      <a href={`/leads/${report.leadId}`}>@{leadHandle}</a>
                    ) : (
                      <span className={`pill ${report.status === 'pending' ? 'warn' : ''}`}>
                        {report.status === 'pending' ? 'waiting' : 'set aside'}
                      </span>
                    )}
                  </td>
                  <td>
                    {report.status === 'linked' && (
                      <ActionForm action={unlinkReport}>
                        <input type="hidden" name="reportId" value={report.id} />
                        <button type="submit">Unlink</button>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Calendly deliveries</h2>
      <p className="sub">
        Every booking Calendly has sent, and what happened to it. A registered webhook that never
        delivers looks exactly like nobody booking — this is how you tell the difference.
      </p>
      {activity.length === 0 ? (
        <p className="empty">
          Nothing received yet. Expected until the first real booking comes through.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row) => {
                const rejected = row.eventType === 'rejected';
                const invitee = (
                  row.payload as { payload?: { name?: string; email?: string }; reason?: string }
                );
                return (
                  <tr key={row.id}>
                    <td>{formatCallTime(row.createdAt)}</td>
                    <td>{rejected ? 'rejected' : row.eventType.replace('invitee.', '')}</td>
                    <td>
                      {rejected ? (
                        <span className="pill danger">{invitee?.reason ?? 'bad signature'}</span>
                      ) : row.matchedLeadId ? (
                        <a className="pill ok" href={`/leads/${row.matchedLeadId}`}>
                          matched · {row.matchStrategy}
                        </a>
                      ) : (
                        <span className="pill warn">
                          no lead matched{invitee?.payload?.email ? ` · ${invitee.payload.email}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>Try it without telling anyone</h2>
      <div className="card">
        <p className="sub" style={{ marginTop: 0 }}>
          Creates a fake booking two hours from now so you can walk the whole flow — confirm it,
          triage it, add notes. It&apos;s labelled TEST everywhere it appears and it never posts to
          Discord, so nobody gets pinged about a call that isn&apos;t real.
        </p>
        <div className="card-row">
          <ActionForm action={createTestBooking}>
            <button className="btn-primary" type="submit">
              Create a test booking
            </button>
          </ActionForm>
          {testCount > 0 && (
            <ActionForm action={clearTestData}>
              <button type="submit">
                Delete test data ({testCount})
              </button>
            </ActionForm>
          )}
        </div>
      </div>

      <h2>Unmatched bookings</h2>
      <p className="sub">
        Calls that came in from Calendly but matched no lead. Each one is a real call on the
        calendar — find the lead and re-send them a tracked link, or create the lead.
      </p>
      {unmatched.length === 0 ? (
        <p className="empty">Nothing unmatched.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Name</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((row) => {
                const invitee = (row.payload as { payload?: { name?: string; email?: string } })
                  ?.payload;
                return (
                  <tr key={row.id}>
                    <td>{formatDay(row.createdAt)}</td>
                    <td>{invitee?.name ?? '—'}</td>
                    <td>{invitee?.email ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>People</h2>
      <p className="sub">
        <a href="/admin/people">Add someone, change an address or revoke access →</a>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Can sign in</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.email.startsWith('CHANGEME') ? <em>needs a real address</em> : p.email}</td>
                <td>{p.role}</td>
                <td>{p.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent EOD reports</h2>
      {recentEod.length === 0 ? (
        <p className="empty">None submitted yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Outbounds</th>
                <th>Follow-ups</th>
                <th>Replies</th>
                <th>Booked</th>
              </tr>
            </thead>
            <tbody>
              {recentEod.map((r) => (
                <tr key={r.id}>
                  <td>{r.reportDate}</td>
                  <td>{r.totalOutbounds ?? '—'}</td>
                  <td>{r.totalFollowUps ?? '—'}</td>
                  <td>{r.totalLeadsWithReplies ?? '—'}</td>
                  <td>{r.callsBooked ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
