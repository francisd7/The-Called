import type { leads } from '@/db/schema';
import { relativeDays } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;

/** Small, dense tile for the follow-ups grid - enough to decide, not to read. */
export function MiniLeadTile({
  lead,
  setterNames,
}: {
  lead: Lead;
  setterNames?: Map<string, string>;
}) {
  const setter = lead.setterId ? setterNames?.get(lead.setterId) : null;
  const overdue = lead.nextFollowUpAt ? lead.nextFollowUpAt < new Date() : false;

  return (
    <a className="mini" href={`/leads/${lead.id}`}>
      <span className="mini-handle">{lead.name?.trim() || `@${lead.igHandle}`}</span>
      <span className="mini-meta">
        {lead.nextFollowUpAt && (
          <span className={`pill${overdue ? ' warn' : ''}`}>
            {relativeDays(lead.nextFollowUpAt)}
          </span>
        )}
        <span className={`pill${setter ? '' : ' warn'}`}>{setter ?? 'Unassigned'}</span>
      </span>
    </a>
  );
}
