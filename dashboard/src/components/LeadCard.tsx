import type { leads } from '@/db/schema';
import { SetterBadge } from '@/components/SetterBadge';
import { formatCallTime, formatTimeOnly, relativeDays } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;

/**
 * Lookups are passed in rather than fetched here: a list renders dozens of
 * these, and resolving a setter name or stage label per card would be a query
 * per row.
 */
export type LeadCardLookups = {
  setterNames?: Map<string, string>;
  setterColors?: Map<string, string | null>;
  stageLabels?: Map<string, string>;
  qualityLabels?: Map<string, string>;
};

export function LeadCard({
  lead,
  showDate = false,
  setterNames,
  setterColors,
  stageLabels,
  qualityLabels,
  children,
}: {
  lead: Lead;
  showDate?: boolean;
  children?: React.ReactNode;
} & LeadCardLookups) {
  const title = lead.name?.trim() || `@${lead.igHandle}`;
  const setterName = lead.setterId ? setterNames?.get(lead.setterId) : null;
  const stageLabel = lead.conversationStage
    ? (stageLabels?.get(lead.conversationStage) ?? lead.conversationStage)
    : null;
  const qualityLabel = lead.leadQuality
    ? (qualityLabels?.get(lead.leadQuality) ?? lead.leadQuality)
    : null;

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
        {lead.isTest && <span className="pill danger">TEST</span>}
        {/* Came from Post Call, which has a name but no handle. Saying so beats
            showing an invented one as though it were real. */}
        {lead.needsHandle && <span className="pill warn">Needs IG handle</span>}
        {stageLabel && <span className="pill">{stageLabel}</span>}
        <SetterBadge
          name={setterName}
          color={lead.setterId ? setterColors?.get(lead.setterId) : null}
        />
        {qualityLabel && <span className="pill">{qualityLabel}</span>}

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
