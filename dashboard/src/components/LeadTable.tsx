import type { leads } from '@/db/schema';
import { SetterBadge } from '@/components/SetterBadge';
import { relativeDays } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;

/**
 * The full lead list as a table rather than stacked cards. At fifty rows a page
 * the card layout ran to several screens of scrolling; a table is both denser
 * and easier to scan down a single column.
 */
export function LeadTable({
  rows,
  setterNames,
  setterColors,
  stageLabels,
}: {
  rows: Lead[];
  setterNames?: Map<string, string>;
  setterColors?: Map<string, string | null>;
  stageLabels?: Map<string, string>;
}) {
  return (
    <div className="table-wrap">
      <table className="lead-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Stage</th>
            <th>Setter</th>
            <th>Last contact</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => {
            const setter = lead.setterId ? setterNames?.get(lead.setterId) : null;
            const stage = lead.conversationStage
              ? (stageLabels?.get(lead.conversationStage) ?? lead.conversationStage)
              : '—';
            return (
              <tr key={lead.id}>
                <td>
                  <a href={`/leads/${lead.id}`}>{lead.name?.trim() || `@${lead.igHandle}`}</a>
                </td>
                <td>{stage}</td>
                <td>
                  <SetterBadge
                    name={setter}
                    color={lead.setterId ? setterColors?.get(lead.setterId) : null}
                  />
                </td>
                <td>{lead.lastContactAt ? relativeDays(lead.lastContactAt) : '—'}</td>
                <td>
                  <span className="mini-meta">
                    {lead.isActiveConvo && <span className="pill ok">Active</span>}
                    {lead.callBooked && !lead.callCancelled && <span className="pill">Booked</span>}
                    {lead.callCancelled && <span className="pill danger">Cancelled</span>}
                    {lead.closed && <span className="pill ok">Closed</span>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
