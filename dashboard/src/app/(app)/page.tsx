import { auth } from '@/auth';
import { CallTile } from '@/components/CallTile';
import { MiniLeadTile } from '@/components/MiniLeadTile';
import { formatCallTime } from '@/lib/dates';
import { PersonPanel } from '@/components/PersonPanel';
import {
  getActiveOffers,
  getAssignableSetters,
  getClosers,
  getActiveConvos,
  getCallsAwaitingOutcome,
  getDueFollowUps,
  getLeadCardLookups,
  getMoneyTotals,
  getPeriodSummary,
  getPipelineSummary,
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

  const session = await auth();
  const userId = session!.user.id;
  const isSetter = session!.user.role === 'setter';

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
  ]);

  const money0 = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // Setters either side of the team column, so the shared list sits in the
  // middle rather than at one end. With an odd number one side just gets more.
  const half = Math.ceil(board.people.length / 2);
  const leftPeople = board.people.slice(0, half);
  const rightPeople = board.people.slice(half);

  const offerById = new Map(offers.map((o) => [o.id, o]));
  const tileProps = { setters, closers };

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

      {/* Period-scoped: these change with the tab above. */}
      <div className="stats">
        <div className="stat tone-blue">
          <div className="stat-n">{periodStats.booked}</div>
          <div className="stat-l">calls booked</div>
        </div>
        <div className="stat tone-violet">
          <div className="stat-n">{periodStats.newLeads}</div>
          <div className="stat-l">new leads</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(periodStats.cash)}</div>
          <div className="stat-l">cash collected</div>
        </div>
        <div className="stat tone-green">
          <div className="stat-n">{money0(periodStats.contract)}</div>
          <div className="stat-l">revenue generated</div>
        </div>
        <div className="stat tone-teal">
          <div className="stat-n">{periodStats.deals}</div>
          <div className="stat-l">deals closed</div>
        </div>
      </div>

      {/* Always-now: what needs doing regardless of which period is selected. */}
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

      <h2>Calls today</h2>
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

      {awaitingOutcome.total > 0 && (
        <>
          <h2>Waiting on an outcome</h2>
          <p className="sub">
            {awaitingOutcome.total} call{awaitingOutcome.total === 1 ? ' has' : 's have'} been and
            gone without a result recorded. Until these are logged, the funnel and the cash figures
            are behind.
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
