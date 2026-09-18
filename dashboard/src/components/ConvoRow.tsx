import type { leads } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { markMessageSent, toggleActiveConvo } from '@/lib/assignActions';
import { relativeDays, teamDateString } from '@/lib/dates';

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
  const silent = lead.lastOutreachAt ?? lead.lastContactAt;
  const stale = silent ? Date.now() - silent.getTime() > 7 * 86_400_000 : true;
  // One press per day per lead. Showing it as already done stops a setter
  // wondering whether the first press registered.
  const doneToday =
    lead.lastOutreachAt !== null && teamDateString(lead.lastOutreachAt) === teamDateString();

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
            {silent ? relativeDays(silent) : 'never messaged'}
          </span>
          {lead.callBooked && !lead.callCancelled && <span className="pill ok">Call booked</span>}
        </span>
      </div>

      <span className="convo-actions">
        <ActionForm action={markMessageSent} successMessage="Logged">
          <input type="hidden" name="leadId" value={lead.id} />
          <button
            type="submit"
            className={`convo-msg${doneToday ? ' is-done' : ''}`}
            title={doneToday ? 'Already logged today' : 'Log that you messaged them today'}
          >
            {doneToday ? '✓ Sent' : 'Sent'}
          </button>
        </ActionForm>
        <ActionForm action={toggleActiveConvo}>
          <input type="hidden" name="leadId" value={lead.id} />
          <button type="submit" className="todo-x" title="Mark not active" aria-label="Mark not active">
            ×
          </button>
        </ActionForm>
      </span>
    </li>
  );
}
