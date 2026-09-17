import type { leads } from '@/db/schema';
import { formatCallTime, formatTimeOnly, relativeDays } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;

export function LeadCard({
  lead,
  showDate = false,
  children,
}: {
  lead: Lead;
  showDate?: boolean;
  children?: React.ReactNode;
}) {
  const title = lead.name?.trim() || `@${lead.igHandle}`;

  return (
    <article className="card">
      <div className="card-head">
        <a className="card-title" href={`/leads/${lead.id}`}>
          {title}
        </a>
        {lead.callScheduledFor && (
          <span className="card-meta">
            {showDate ? formatCallTime(lead.callScheduledFor) : formatTimeOnly(lead.callScheduledFor)}
          </span>
        )}
      </div>

      <div className="card-meta">
        {lead.name?.trim() ? `@${lead.igHandle}` : null}
        {lead.closerName ? ` · with ${lead.closerName}` : null}
        {lead.phone ? ` · ${lead.phone}` : null}
      </div>

      <div className="card-row">
        {lead.callBooked && !lead.callCancelled && (
          <span className={`pill ${lead.confirmed ? 'ok' : 'warn'}`}>
            {lead.confirmed ? '✓ Confirmed' : 'Not confirmed'}
          </span>
        )}
        {lead.callBooked && !lead.callCancelled && (
          <span className={`pill ${lead.triaged ? 'ok' : 'warn'}`}>
            {lead.triaged ? '✓ Triaged' : 'Not triaged'}
          </span>
        )}
        {lead.callCancelled && <span className="pill danger">Cancelled</span>}
        {!lead.callBooked && lead.nextFollowUpAt && (
          <span className={`pill ${lead.nextFollowUpAt < new Date() ? 'warn' : ''}`}>
            Follow up {relativeDays(lead.nextFollowUpAt)}
          </span>
        )}
        {!lead.callBooked && lead.followUps > 0 && (
          <span className="pill">{lead.followUps} follow-ups</span>
        )}
        {children}
      </div>
    </article>
  );
}
