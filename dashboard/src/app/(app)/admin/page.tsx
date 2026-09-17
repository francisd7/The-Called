import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { eodReports, users } from '@/db/schema';
import { formatDay } from '@/lib/dates';
import { getPipelineSummary, getUnmatchedBookings } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  // The nav hides this link for non-admins, but the route has to enforce it
  // too - a hidden link is not access control.
  if (session?.user?.role !== 'admin') redirect('/');

  const [summary, unmatched, people, recentEod] = await Promise.all([
    getPipelineSummary(),
    getUnmatchedBookings(),
    db.select().from(users).orderBy(users.name),
    db.select().from(eodReports).orderBy(desc(eodReports.reportDate)).limit(10),
  ]);

  return (
    <>
      <h1>Admin</h1>

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
