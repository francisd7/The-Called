import type { leads } from '@/db/schema';
import { SetterBadge } from '@/components/SetterBadge';
import { relativeDays } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;

/** Small, dense tile for the follow-ups grid - enough to decide, not to read. */
export function MiniLeadTile({
  lead,
  setterNames,
  setterColors,
}: {
  lead: Lead;
  setterNames?: Map<string, string>;
  setterColors?: Map<string, string | null>;
}) {
  const setter = lead.setterId ? setterNames?.get(lead.setterId) : null;
  // How long it's been silent, matching what the Dashboard section now selects
  // on - a "next follow-up" date would be blank on nearly every lead.
  const silent = lead.lastOutreachAt ?? lead.lastContactAt ?? lead.leadCreatedAt;

  return (
    <a className="mini" href={`/leads/${lead.id}`}>
      <span className="mini-handle">{lead.name?.trim() || `@${lead.igHandle}`}</span>
      <span className="mini-meta">
        <span className="pill warn">{relativeDays(silent)}</span>
        <SetterBadge name={setter} color={lead.setterId ? setterColors?.get(lead.setterId) : null} />
      </span>
    </a>
  );
}
