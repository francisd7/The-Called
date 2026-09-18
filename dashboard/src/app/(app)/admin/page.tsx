import { redirect } from 'next/navigation';
import { count, desc, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { eodReports, leads, offers, users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { formatDay } from '@/lib/dates';
import { getPipelineSummary, getUnmatchedBookings } from '@/lib/queries';
import { runAirtableImport, runCalendlySetup } from '@/lib/setupActions';

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

  const [summary, unmatched, people, recentEod, offerRows, [{ leadCount }]] = await Promise.all([
    getPipelineSummary(),
    getUnmatchedBookings(),
    db.select().from(users).orderBy(users.name),
    db.select().from(eodReports).orderBy(desc(eodReports.reportDate)).limit(10),
    db.select().from(offers).orderBy(offers.sortOrder),
    db.select({ leadCount: count() }).from(leads),
  ]);

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
