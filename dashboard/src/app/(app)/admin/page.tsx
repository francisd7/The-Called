import { redirect } from 'next/navigation';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { eodReports, leads, users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { formatCallTime, formatDay } from '@/lib/dates';
import { getPipelineSummary, getUnmatchedBookings } from '@/lib/queries';
import { countDuplicateGroups } from '@/lib/duplicates';
import { getIssues } from '@/lib/issues';
import { resolveIssue } from '@/lib/issueActions';

export const dynamic = 'force-dynamic';

/** A number worth acting on, or nothing at all. Zeroes are not news. */
function Attention({
  n,
  label,
  href,
}: {
  n: number;
  label: string;
  href: string;
}) {
  if (n === 0) return null;
  return (
    <a className="stat alert stat-link" href={href}>
      <div className="stat-n">{n}</div>
      <div className="stat-l">{label}</div>
    </a>
  );
}

export default async function AdminPage() {
  const session = await auth();
  // The nav hides this link for non-admins, but the route has to enforce it
  // too - a hidden link is not access control.
  if (session?.user?.role !== 'admin') redirect('/');

  const [summary, unmatched, issues, people, recentEod, duplicates] = await Promise.all([
    getPipelineSummary(),
    getUnmatchedBookings(),
    getIssues('open'),
    db.select().from(users).orderBy(users.name),
    db.select().from(eodReports).orderBy(desc(eodReports.reportDate)).limit(10),
    countDuplicateGroups(db),
  ]);

  // Same definition the lead tracker uses for its own unassigned count, so the
  // two screens can't disagree about how much there is to hand out.
  const [{ unassigned }] = await db
    .select({ unassigned: count() })
    .from(leads)
    .where(and(eq(leads.isActiveConvo, true), isNull(leads.setterId), eq(leads.isTest, false)));

  return (
    <>
      <h1>Admin</h1>

      <div className="stats">
        <div className="stat stat-hero tone-blue">
          <div className="stat-n">{summary.totalLeads.toLocaleString()}</div>
          <div className="stat-l">leads</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{summary.bookedCalls}</div>
          <div className="stat-l">live bookings</div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{summary.todayCalls}</div>
          <div className="stat-l">calls today</div>
        </div>
        <div className="stat tone-violet">
          <div className="stat-n">{summary.needsConfirming}</div>
          <div className="stat-l">to confirm</div>
        </div>
        <div className="stat tone-violet">
          <div className="stat-n">{summary.needsTriage}</div>
          <div className="stat-l">to triage</div>
        </div>
      </div>

      {(issues.length > 0 || duplicates > 0 || unmatched.length > 0 || unassigned > 0) && (
        <>
          <h2>Needs a look</h2>
          <div className="stats stats-attention">
            <Attention n={issues.length} label="problems reported" href="#problems" />
            <Attention n={duplicates} label="possible duplicates" href="/leads/duplicates" />
            <Attention n={unmatched.length} label="unmatched bookings" href="#unmatched" />
            <Attention n={unassigned} label="unassigned conversations" href="/leads" />
          </div>
        </>
      )}

      <div id="problems" />
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

      <div id="unmatched" />
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

      <h2>Setup &amp; imports</h2>
      <p className="sub">
        Connecting Calendly, pulling data across from Airtable, and trying the booking flow without
        telling anyone. Kept on its own page because none of it is a daily job.
      </p>
      <div className="card">
        <div className="card-row" style={{ marginTop: 0 }}>
          <a className="btn btn-primary" href="/admin/setup">
            Open setup &amp; imports
          </a>
          <a className="btn" href="/admin/people">
            Manage people
          </a>
        </div>
      </div>
    </>
  );
}
