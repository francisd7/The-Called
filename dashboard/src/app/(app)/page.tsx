import { auth } from '@/auth';
import { ActionForm } from '@/components/ActionForm';
import { LeadCard } from '@/components/LeadCard';
import { confirmLead } from '@/lib/actions';
import {
  getDueFollowUps,
  getLeadCardLookups,
  getPipelineSummary,
  getTodaysCalls,
  getUpcomingCalls,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

function ConfirmButtons({ leadId }: { leadId: string }) {
  return (
    <>
      {/* Two buttons rather than a dropdown: a confirmation arrives either in
          the DMs or on a call, and which one it was is worth recording. */}
      <ActionForm action={confirmLead} successMessage="Confirmed">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="method" value="dm" />
        <button type="submit">Confirmed in DMs</button>
      </ActionForm>
      <ActionForm action={confirmLead} successMessage="Confirmed">
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="method" value="phone" />
        <button type="submit">Confirmed by phone</button>
      </ActionForm>
    </>
  );
}

export default async function TodayPage() {
  const session = await auth();
  const [summary, todaysCalls, upcoming, followUps, lookups] = await Promise.all([
    getPipelineSummary(),
    getTodaysCalls(),
    getUpcomingCalls(),
    getDueFollowUps(session?.user?.role === 'setter' ? session.user.id : undefined),
    getLeadCardLookups(),
  ]);

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
        todaysCalls.map((lead) => (
          <LeadCard key={lead.id} lead={lead} {...lookups}>
            {!lead.confirmed && <ConfirmButtons leadId={lead.id} />}
            {!lead.triaged && (
              <a className="btn" href={`/leads/${lead.id}#triage`}>
                Triage
              </a>
            )}
          </LeadCard>
        ))
      )}

      <h2>Next 7 days</h2>
      {upcoming.length === 0 ? (
        <p className="empty">Nothing booked in the next week.</p>
      ) : (
        upcoming.map((lead) => (
          <LeadCard key={lead.id} lead={lead} showDate {...lookups}>
            {!lead.confirmed && <ConfirmButtons leadId={lead.id} />}
          </LeadCard>
        ))
      )}

      <h2>Follow-ups due</h2>
      {followUps.length === 0 ? (
        <p className="empty">Nothing overdue. </p>
      ) : (
        followUps.map((lead) => <LeadCard key={lead.id} lead={lead} {...lookups} />)
      )}
    </>
  );
}
