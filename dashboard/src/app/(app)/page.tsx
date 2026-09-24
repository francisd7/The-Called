import { currentUser } from '@/lib/session';
import { db } from '@/db';
import { backupIsDue } from '@/lib/backup';
import { CallTile } from '@/components/CallTile';
import { MiniLeadTile } from '@/components/MiniLeadTile';
import { formatCallTime } from '@/lib/dates';
import { PersonPanel } from '@/components/PersonPanel';
import { PostCallInbox } from '@/components/PostCallInbox';
import { BackupWatch } from '@/components/BackupWatch';
import { Sparkline, Delta } from '@/components/charts/Sparkline';
import { DayStrip } from '@/components/DayStrip';
import { periodTrends } from '@/lib/kpis';
import { paceFor } from '@/lib/pace';
import {
  getActiveOffers,
  getAssignableSetters,
  getClosers,
  getActiveConvos,
  getCalendlyHealth,
  getCallsAwaitingOutcome,
  getDueFollowUps,
  getLeadCardLookups,
  getMoneyTotals,
  getPeriodSummary,
  getPipelineSummary,
  getMonthToDate,
  getMonthlyTargets,
  getPostCallInbox,
  getTodaysCalls,
  getUpcomingCalls,
  getWeekBoard,
  type Period,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
] as const;

export default async function TodayPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawPeriod = params.period;
  const period = (
    typeof rawPeriod === 'string' && PERIODS.some((p) => p.key === rawPeriod) ? rawPeriod : 'today'
  ) as Period;

  const me = await currentUser();
  const userId = me!.id;
  const isSetter = me!.role === 'setter';

  const [
    summary,
    todaysCalls,
    upcoming,
    followUps,
    lookups,
    setters,
    closers,
    offers,
    board,
    money,
    convos,
    periodStats,
    awaitingOutcome,
    postCall,
    calendly,
  ] = await Promise.all([
    getPipelineSummary(),
    getTodaysCalls(),
    getUpcomingCalls(),
    getDueFollowUps(isSetter ? userId : undefined, 12),
    getLeadCardLookups(),
    getAssignableSetters(),
    getClosers(),
    getActiveOffers(),
    getWeekBoard(),
    getMoneyTotals(),
    getActiveConvos(0),
    getPeriodSummary(period),
    getCallsAwaitingOutcome(),
    getPostCallInbox(),
    me!.role === 'admin' ? getCalendlyHealth() : null,
  ]);

  // A webhook that has quietly stopped delivering looks exactly like a quiet
  // week, and only one of those is survivable. Admin-only: it's a plumbing
  // problem, not something a setter can act on.
  const calendlyQuiet =
    calendly && (!calendly.everDelivered || (calendly.daysQuiet ?? 0) >= 7) ? calendly : null;

  const money0 = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // Setters either side of the team column, so the shared list sits in the
  // middle rather than at one end. With an odd number one side just gets more.
  const half = Math.ceil(board.people.length / 2);
  const leftPeople = board.people.slice(0, half);
  const rightPeople = board.people.slice(half);

  const offerById = new Map(offers.map((o) => [o.id, o]));
  const tileProps = { setters, closers };
  const backupDue = await backupIsDue(db);
  const trends = await periodTrends(period);
  const [targets, mtd] = await Promise.all([getMonthlyTargets(), getMonthToDate()]);
  const now = new Date();
  const pace = {
    calls: paceFor(mtd.calls, targets.get('calls') ?? null, now),
    cash: paceFor(mtd.cash, targets.get('cash') ?? null, now),
  };

  return (
    <>
      {/* Matches the nav label - "Today" in the nav and "Dashboard" on the page
          read as two different places. */}
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Calls first, then the week, then anything overdue a follow-up.</p>
        </div>
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <a
              key={p.key}
              href={p.key === 'today' ? '/' : `/?period=${p.key}`}
              className={`btn${p.key === period ? ' btn-primary' : ''}`}
            >
              {p.label}
            </a>
          ))}
        </div>
      </div>

      {calendlyQuiet && (
        <p className="banner-warn">
          <strong>Calendly has gone quiet.</strong>{' '}
          {calendlyQuiet.everDelivered
            ? `Nothing delivered in ${calendlyQuiet.daysQuiet} days.`
            : 'Nothing has ever been delivered.'}{' '}
          Either nobody has booked, or the webhook has stopped — those look identical from here.{' '}
          <a href="/admin">Check Calendly deliveries</a>.
        </p>
      )}

      {/* Ten tiles in two rows that look identical, where five follow the tab
          above and five are always now. Without a word saying which is which,
          pressing "This week" changes half the numbers and leaves the rest,
          and the only way to find out which half is to remember. */}
      <p className="stats-label">
        {PERIODS.find((p) => p.key === period)?.label ?? 'Today'}
        <span className="stats-note">
          {period === 'today'
            ? 'line: last 14 days · against the same time yesterday'
            : period === 'week'
              ? 'line: last 12 weeks · against the same point last week'
              : 'line: last 12 months · against the same point last month'}
        </span>
      </p>
      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">{periodStats.booked}</div>
          <div className="stat-l">calls booked</div>
          <div className="stat-foot">
            <Sparkline points={trends.calls.series} tone="accent" />
            <Delta now={trends.calls.now} before={trends.calls.before} />
          </div>
        </div>
        <div className="stat tone-violet">
          <div className="stat-n">{periodStats.newLeads}</div>
          <div className="stat-l">new leads</div>
          <div className="stat-foot">
            <Sparkline points={trends.newLeads.series} tone="accent" />
            <Delta now={trends.newLeads.now} before={trends.newLeads.before} />
          </div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(periodStats.cash)}</div>
          <div className="stat-l">cash collected</div>
          <div className="stat-foot">
            <Sparkline points={trends.cash.series} tone="ok" />
            <Delta now={trends.cash.now} before={trends.cash.before} />
          </div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(periodStats.contract)}</div>
          <div className="stat-l">revenue generated</div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{periodStats.deals}</div>
          <div className="stat-l">deals closed</div>
          <div className="stat-foot">
            <Sparkline points={trends.deals.series} tone="ok" />
            <Delta now={trends.deals.now} before={trends.deals.before} />
          </div>
        </div>
      </div>

      {/* Only where a target has actually been set. A bar against nothing would
          show every month as a miss from the first of it. */}
      {(pace.calls || pace.cash) && (
        <>
          <p className="stats-label">
            This month against target
            <span className="stats-note">
              the mark is where today sits in the month, counted in working days
            </span>
          </p>
          <div className="stats">
            {pace.calls && (
              <div className="stat tone-blue">
                <div className="stat-n">
                  {mtd.calls}
                  <span className="stat-of"> / {pace.calls.target}</span>
                </div>
                <div className="stat-l">calls booked</div>
                <div className="pace">
                  <span className="pace-fill" style={{ width: `${pace.calls.done * 100}%` }} />
                  <span className="pace-mark" style={{ left: `${pace.calls.elapsed * 100}%` }} />
                </div>
                <div className="stat-foot-text">
                  {pace.calls.ahead ? 'on pace' : `${Math.round(pace.calls.expected - mtd.calls)} behind pace`}
                </div>
              </div>
            )}
            {pace.cash && (
              <div className="stat tone-green">
                <div className="stat-n">
                  {money0(mtd.cash)}
                  <span className="stat-of"> / {money0(pace.cash.target)}</span>
                </div>
                <div className="stat-l">cash collected</div>
                <div className="pace">
                  <span className="pace-fill pace-ok" style={{ width: `${pace.cash.done * 100}%` }} />
                  <span className="pace-mark" style={{ left: `${pace.cash.elapsed * 100}%` }} />
                </div>
                <div className="stat-foot-text">
                  {pace.cash.ahead ? 'on pace' : `${money0(Math.round(pace.cash.expected - mtd.cash))} behind pace`}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Always-now: what needs doing regardless of which period is selected. */}
      <p className="stats-label">Right now</p>
      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">{summary.todayCalls}</div>
          <div className="stat-l">calls today</div>
        </div>
        <div className={`stat tone-amber${summary.needsConfirming > 0 ? ' alert' : ''}`}>
          <div className="stat-n">{summary.needsConfirming}</div>
          <div className="stat-l">need confirming</div>
        </div>
        <div className={`stat tone-amber${summary.needsTriage > 0 ? ' alert' : ''}`}>
          <div className="stat-n">{summary.needsTriage}</div>
          <div className="stat-l">need triage</div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{convos.teamTotal}</div>
          <div className="stat-l">active convos</div>
        </div>
      </div>

      {/* Ordered by what somebody has to do about it, soonest first: the
          calls happening today, then the week ahead, then the reports
          waiting to be put on a lead, then the calls still owed a result. */}
      <h2>Calls today</h2>
      <DayStrip calls={todaysCalls} />
      {todaysCalls.length === 0 ? (
        <p className="empty">No calls booked for today.</p>
      ) : (
        <div className="tile-grid">
          {todaysCalls.map((lead) => (
            <CallTile
              key={lead.id}
              lead={lead}
              offerKey={lead.offerId ? offerById.get(lead.offerId)?.key : null}
              offerLabel={lead.offerId ? offerById.get(lead.offerId)?.label : null}
              {...tileProps}
            />
          ))}
        </div>
      )}

      <h2>Next 7 days</h2>
      {upcoming.length === 0 ? (
        <p className="empty">Nothing booked in the next week.</p>
      ) : (
        <div className="tile-grid">
          {upcoming.map((lead) => (
            <CallTile
              key={lead.id}
              lead={lead}
              offerKey={lead.offerId ? offerById.get(lead.offerId)?.key : null}
              offerLabel={lead.offerId ? offerById.get(lead.offerId)?.label : null}
              showDate
              {...tileProps}
            />
          ))}
        </div>
      )}

      <BackupWatch due={backupDue} />
      <PostCallInbox reports={postCall.pending} staleMinutes={postCall.staleMinutes} />

      {awaitingOutcome.total > 0 && (
        <>
          <h2>Waiting on an outcome</h2>
          <p className="sub">
            {awaitingOutcome.total} call{awaitingOutcome.total === 1 ? ' has' : 's have'} been and
            gone without a result recorded. Until {awaitingOutcome.total === 1 ? 'it is' : 'these are'}{' '}
            logged, the funnel and the cash figures are behind.
          </p>
          <div className="mini-grid">
            {awaitingOutcome.rows.map((lead) => (
              <a className="mini mini-attention" key={lead.id} href={`/leads/${lead.id}#outcome`}>
                <span className="mini-handle">{lead.name?.trim() || `@${lead.igHandle}`}</span>
                <span className="mini-meta">
                  <span className="pill warn">{formatCallTime(lead.callScheduledFor)}</span>
                  {lead.closerName && <span className="pill">{lead.closerName}</span>}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      <h2>This week</h2>
      {/* Column count comes from how many panels there actually are. Hardcoding
          three looked right with two setters and wrapped the moment there was
          anyone else. The team column gets the extra width. */}
      <div
        className="week-board"
        style={
          {
            '--board-columns': [
              ...leftPeople.map(() => '1fr'),
              '1.4fr',
              ...rightPeople.map(() => '1fr'),
            ].join(' '),
          } as React.CSSProperties
        }
      >
        {leftPeople.map((person) => (
          <PersonPanel
            key={person.id}
            title={person.id === userId ? `${person.name} (you)` : person.name}
            ownerId={person.id}
            focus={person.focus}
            todos={person.todos}
            focusPlaceholder="One thing this week. One, not five."
            emptyText="Nothing on this list yet."
          />
        ))}

        <PersonPanel
          title="Team"
          ownerId={null}
          focus={board.team.focus}
          todos={board.team.todos}
          focusPlaceholder="What is the whole team pushing on this week?"
          emptyText="Nothing on the team list yet."
          wide
        />

        {rightPeople.map((person) => (
          <PersonPanel
            key={person.id}
            title={person.id === userId ? `${person.name} (you)` : person.name}
            ownerId={person.id}
            focus={person.focus}
            todos={person.todos}
            focusPlaceholder="One thing this week. One, not five."
            emptyText="Nothing on this list yet."
          />
        ))}
      </div>

      <h2>Going quiet</h2>
      {followUps.total === 0 ? (
        <p className="empty">
          Nothing has gone quiet. Active conversations are all inside a week.
        </p>
      ) : (
        <>
          <p className="sub">
            {followUps.total} active conversation{followUps.total === 1 ? '' : 's'} with no contact
            in over a week
            {followUps.total > followUps.rows.length && ` — showing the ${followUps.rows.length} quietest`}
          </p>
          <div className="mini-grid">
            {followUps.rows.map((lead) => (
              <MiniLeadTile
                key={lead.id}
                lead={lead}
                setterNames={lookups.setterNames}
                setterColors={lookups.setterColors}
              />
            ))}
          </div>
          {followUps.total > followUps.rows.length && (
            <a className="btn" href="/leads/follow-ups">
              Work through all {followUps.total} in Follow Ups
            </a>
          )}
        </>
      )}
    </>
  );
}
