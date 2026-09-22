import { redirect } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { calendlyEventTypes, leads, offers, users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { formatCallTime, formatDay } from '@/lib/dates';
import { getAllPostCallReports, getRecentCalendlyActivity } from '@/lib/queries';
import {
  clearActiveConvos,
  clearTestData,
  createTestBooking,
  runAirtableImport,
  findCalendlyLinks,
  runCalendlyBackfill,
  runCalendlyCleanup,
  runCalendlySetup,
  runEodImport,
  saveCountedLinks,
} from '@/lib/setupActions';
import { syncPostCall, unlinkReport } from '@/lib/postCallActions';

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li style={{ marginBottom: '0.3rem' }}>
      <span className={`pill ${done ? 'ok' : 'warn'}`}>{done ? '\u2713' : '\u2014'}</span>{' '}
      {children}
    </li>
  );
}

export const dynamic = 'force-dynamic';

/**
 * Everything that wires the dashboard up or pulls data into it, kept off the
 * admin screen proper.
 *
 * These are the buttons you press on a Tuesday when something needs
 * reconnecting or re-importing, not the numbers you read every morning. Mixed
 * in with the numbers they made the page long enough that nobody read either.
 */
export default async function SetupPage() {
  const session = await auth();
  if (session?.user?.role !== 'admin') redirect('/');

  const [people, offerRows, [{ leadCount }], reports, activity, links] = await Promise.all([
    db.select().from(users).orderBy(users.name),
    db.select().from(offers).orderBy(offers.sortOrder),
    db.select({ leadCount: count() }).from(leads),
    getAllPostCallReports(),
    getRecentCalendlyActivity(),
    db.select().from(calendlyEventTypes).orderBy(desc(calendlyEventTypes.bookingCount)),
  ]);

  const [{ testCount }] = await db
    .select({ testCount: count() })
    .from(leads)
    .where(eq(leads.isTest, true));

  const placeholderPeople = people.filter((p) => p.active && p.email.startsWith('CHANGEME'));
  const linkedOffers = offerRows.filter((o) => o.eventTypeUri).length;
  const setupComplete =
    placeholderPeople.length === 0 && linkedOffers === offerRows.length && leadCount > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Setup &amp; imports</h1>
          <p className="sub">
            Connecting Calendly, pulling data across, and trying the flow without telling anyone.
            Nothing here runs on its own.
          </p>
        </div>
        <a className="btn" href="/admin">
          Back to admin
        </a>
      </div>

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

      <h2>Which Calendly links are sales calls</h2>
      <p className="sub">
        A Calendly webhook covers the whole account, so something has to say which links are sales
        calls and which are coaching calls or personal appointments. Most of the booking history
        sits on links that have since been retired — those still count, and they&apos;re listed here
        because the bookings are read from Calendly&apos;s history, not from its current link list.
        Nothing is counted until you tick it.
      </p>
      <div className="card">
        <ActionForm action={findCalendlyLinks}>
          <input type="hidden" name="since" value="2026-06-01" />
          <button type="submit">Find Calendly links</button>
        </ActionForm>
      </div>
      {links.length === 0 ? (
        <p className="empty">
          Nothing found yet — press Find Calendly links to read them off the booking history.
        </p>
      ) : (
        <div className="card">
          <ActionForm action={saveCountedLinks} successMessage="Saved">
            <ul className="todos">
              {links.map((l) => (
                <li className="todo" key={l.id}>
                  <input
                    type="checkbox"
                    name="counted"
                    value={l.uri}
                    defaultChecked={l.counted}
                    id={`link-${l.id}`}
                    style={{ marginTop: '0.2rem' }}
                  />
                  <label className="todo-body" htmlFor={`link-${l.id}`}>
                    <span className="todo-title">{l.name}</span>
                    <span className="todo-meta">
                      <span className="pill">
                        {l.bookingCount} booking{l.bookingCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn-primary" type="submit">
              Save which links count
            </button>
          </ActionForm>
        </div>
      )}

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

      <h2>Take back bookings that shouldn&apos;t be here</h2>
      <p className="sub">
        An earlier version of the import took every link on the Calendly account, so bookings from
        coaching calls and personal appointments were written onto leads — and some of those leads
        were invented for the occasion. This removes them and nothing else: it never imports.
        A lead that already existed keeps everything except the booking, because somebody has been
        working that conversation.
      </p>
      <div className="card">
        <ActionForm action={runCalendlyCleanup}>
          <input type="hidden" name="since" value="2026-06-01" />
          <div className="card-row">
            <button type="submit" name="dryRun" value="1">
              Test clean-up
            </button>
            <button className="btn-danger" type="submit" name="dryRun" value="0">
              Remove them
            </button>
          </div>
        </ActionForm>
      </div>

      <h2>Lead tracker</h2>
      <p className="sub">
        Pulls the Airtable lead tracker across. It fills gaps and never overwrites: a blank row
        won&apos;t clear a booking Calendly made or an outcome a post-call report recorded, and a row
        for somebody Calendly already created joins that lead instead of making a second copy of
        them. Safe to re-run.
      </p>
      <div className="card">
        <div className="card-row">
          <ActionForm action={runAirtableImport}>
            <input type="hidden" name="dryRun" value="1" />
            <button type="submit">Test lead import</button>
          </ActionForm>
          <ActionForm action={runAirtableImport}>
            <input type="hidden" name="dryRun" value="0" />
            <button className="btn-primary" type="submit">
              Import leads from Airtable
            </button>
          </ActionForm>
        </div>
        <p className="sub" style={{ marginTop: '0.6rem' }}>
          {leadCount.toLocaleString()} leads here now. Needs <code>AIRTABLE_PAT</code> set on this
          service.
        </p>
      </div>

      <h2>Start everyone from a blank slate</h2>
      <p className="sub">
        Clears the active-conversation tick on every lead so the setters mark their own. The flag
        the import set was guessed from whatever stage each Airtable row carried, and that guess is
        months old — but it drives the counts, the Going quiet list and each setter&apos;s column, so
        it is better empty than wrong. Nothing else is touched: the stage, the notes and the history
        all stay, and a setter turns theirs back on from the lead itself.
      </p>
      <div className="card">
        <ActionForm action={clearActiveConvos}>
          <div className="card-row" style={{ marginTop: 0 }}>
            <button type="submit" name="dryRun" value="1">
              Test it
            </button>
            <button className="btn-danger" type="submit" name="dryRun" value="0">
              Clear every active tick
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
    </>
  );
}
