import { auth } from '@/auth';
import { CallTile } from '@/components/CallTile';
import { LeadCard } from '@/components/LeadCard';
import { PersonPanel } from '@/components/PersonPanel';
import {
  getActiveOffers,
  getAssignableSetters,
  getClosers,
  getDueFollowUps,
  getLeadCardLookups,
  getPipelineSummary,
  getTodaysCalls,
  getUpcomingCalls,
  getWeekBoard,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
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
  ] = await Promise.all([
    getPipelineSummary(),
    getTodaysCalls(),
    getUpcomingCalls(),
    getDueFollowUps(isSetter ? userId : undefined),
    getLeadCardLookups(),
    getAssignableSetters(),
    getClosers(),
    getActiveOffers(),
    getWeekBoard(),
  ]);

  // Setters either side of the team column, so the shared list sits in the
  // middle rather than at one end. With an odd number one side just gets more.
  const half = Math.ceil(board.people.length / 2);
  const leftPeople = board.people.slice(0, half);
  const rightPeople = board.people.slice(half);

  const offerLabels = new Map(offers.map((o) => [o.id, o.label]));
  const tileProps = { setters, closers };

  return (
    <>
      <h1>Today</h1>
      <p className="sub">Calls first, then anything overdue a follow-up.</p>

      <div className="stats">
        <div className="stat">
          <div className="stat-n">{summary.todayCalls}</div>
          <div className="stat-l">calls today</div>
        </div>
        <div className={`stat${summary.needsConfirming > 0 ? ' alert' : ''}`}>
          <div className="stat-n">{summary.needsConfirming}</div>
          <div className="stat-l">need confirming</div>
        </div>
        <div className={`stat${summary.needsTriage > 0 ? ' alert' : ''}`}>
          <div className="stat-n">{summary.needsTriage}</div>
          <div className="stat-l">need triage</div>
        </div>
        <div className="stat">
          <div className="stat-n">{summary.bookedCalls}</div>
          <div className="stat-l">calls booked</div>
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
              offerLabel={lead.offerId ? offerLabels.get(lead.offerId) : null}
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
              offerLabel={lead.offerId ? offerLabels.get(lead.offerId) : null}
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

      <h2>Follow-ups due</h2>
      {followUps.total === 0 ? (
        <p className="empty">Nothing overdue.</p>
      ) : (
        <>
          <p className="sub">
            {followUps.total} due or overdue
            {followUps.total > followUps.rows.length && ` — showing the ${followUps.rows.length} most overdue`}
          </p>
          {followUps.rows.map((lead) => (
            <LeadCard key={lead.id} lead={lead} {...lookups} />
          ))}
          {followUps.total > followUps.rows.length && (
            <a className="btn" href="/leads">
              See all {followUps.total} in Leads
            </a>
          )}
        </>
      )}
    </>
  );
}
