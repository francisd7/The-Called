import { auth } from '@/auth';
import { CallTile } from '@/components/CallTile';
import { FocusPanel } from '@/components/FocusPanel';
import { LeadCard } from '@/components/LeadCard';
import { TodoList } from '@/components/TodoList';
import {
  getActiveOffers,
  getAssignableSetters,
  getClosers,
  getDueFollowUps,
  getFocuses,
  getLeadCardLookups,
  getMyTodos,
  getPipelineSummary,
  getTeamTodos,
  getTodaysCalls,
  getUpcomingCalls,
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
    myTodos,
    teamTodos,
    focus,
  ] = await Promise.all([
    getPipelineSummary(),
    getTodaysCalls(),
    getUpcomingCalls(),
    getDueFollowUps(isSetter ? userId : undefined),
    getLeadCardLookups(),
    getAssignableSetters(),
    getClosers(),
    getActiveOffers(),
    getMyTodos(userId),
    getTeamTodos(),
    getFocuses(userId),
  ]);

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

      <h2>Focus this week</h2>
      <div className="panel-grid">
        <FocusPanel
          title="Team"
          scope="team"
          focus={focus.team}
          placeholder="What is the whole team pushing on this week?"
        />
        <FocusPanel
          title="Mine"
          scope="mine"
          focus={focus.mine}
          placeholder="Your one thing this week. One, not five."
          others={focus.others}
          ownerNames={lookups.setterNames}
        />
      </div>

      <h2>To-do</h2>
      <div className="panel-grid">
        <TodoList
          todos={myTodos}
          scope="mine"
          title="Mine"
          emptyText="Nothing on your list."
        />
        <TodoList
          todos={teamTodos}
          scope="team"
          title="Team"
          emptyText="Nothing on the team list."
          showOwner
        />
      </div>

      <h2>Follow-ups due</h2>
      {followUps.length === 0 ? (
        <p className="empty">Nothing overdue.</p>
      ) : (
        followUps.map((lead) => <LeadCard key={lead.id} lead={lead} {...lookups} />)
      )}
    </>
  );
}
