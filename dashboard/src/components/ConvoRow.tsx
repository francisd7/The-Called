import type { leads } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { toggleActiveConvo } from '@/lib/assignActions';
import { relativeDays } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;

/**
 * A compact row for the active-conversation columns. Deliberately denser than a
 * lead card: these lists run to dozens and the point is to scan them.
 */
export function ConvoRow({
  lead,
  stageLabels,
}: {
  lead: Lead;
  stageLabels?: Map<string, string>;
}) {
  const stage = lead.conversationStage
    ? (stageLabels?.get(lead.conversationStage) ?? lead.conversationStage)
    : null;
  const stale = lead.lastContactAt
    ? Date.now() - lead.lastContactAt.getTime() > 7 * 86_400_000
    : true;

  return (
    <li className="convo">
      <div className="convo-main">
        <a className="convo-handle" href={`/leads/${lead.id}`}>
          {lead.name?.trim() || `@${lead.igHandle}`}
        </a>
        <span className="convo-meta">
          {stage && <span className="pill">{stage}</span>}
          {/* A week of silence is the signal that a thread needs chasing or
              closing - it's what makes this list worth keeping honest. */}
          <span className={`pill${stale ? ' warn' : ''}`}>
            {lead.lastContactAt ? relativeDays(lead.lastContactAt) : 'never contacted'}
          </span>
          {lead.callBooked && !lead.callCancelled && <span className="pill ok">Call booked</span>}
        </span>
      </div>
      <ActionForm action={toggleActiveConvo}>
        <input type="hidden" name="leadId" value={lead.id} />
        <button type="submit" className="todo-x" title="Mark not active" aria-label="Mark not active">
          ×
        </button>
      </ActionForm>
    </li>
  );
}
