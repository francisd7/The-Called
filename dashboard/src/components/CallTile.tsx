import type { leads, users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { AutoSubmitSelect } from '@/components/AutoSubmitSelect';
import { confirmLead, unconfirmLead } from '@/lib/actions';
import { claimLead, setCloser, setSetter } from '@/lib/assignActions';
import { formatCallTime, formatTimeOnly } from '@/lib/dates';

type Lead = typeof leads.$inferSelect;
type Person = typeof users.$inferSelect;

/**
 * A booked call, as a tile in a grid. Everything a setter does before the call -
 * confirm, triage, own it, say who's taking it - is on the tile, so working
 * through the day's calls doesn't mean opening and backing out of each one.
 */
export function CallTile({
  lead,
  offerLabel,
  setters,
  closers,
  showDate = false,
}: {
  lead: Lead;
  offerLabel?: string | null;
  setters: Person[];
  closers: Person[];
  showDate?: boolean;
}) {
  const title = lead.name?.trim() || `@${lead.igHandle}`;
  const unclaimed = !lead.setterId;

  return (
    <article className={`tile${unclaimed ? ' tile-unclaimed' : ''}`}>
      <div className="tile-head">
        <a className="tile-title" href={`/leads/${lead.id}`}>
          {title}
        </a>
        <span className="tile-when">
          {showDate ? formatCallTime(lead.callScheduledFor) : formatTimeOnly(lead.callScheduledFor)}
        </span>
      </div>

      <div className="tile-sub">
        @{lead.igHandle}
        {lead.phone ? ` · ${lead.phone}` : ''}
      </div>
      {offerLabel && <div className="tile-sub">{offerLabel}</div>}

      <div className="tile-pills">
        {lead.isTest && <span className="pill danger">TEST</span>}
        <span className={`pill ${lead.confirmed ? 'ok' : 'warn'}`}>
          {lead.confirmed ? '✓ Confirmed' : 'Not confirmed'}
        </span>
        <span className={`pill ${lead.triaged ? 'ok' : 'warn'}`}>
          {lead.triaged ? '✓ Triaged' : 'Not triaged'}
        </span>
      </div>

      <div className="tile-actions">
        {lead.confirmed ? (
          <ActionForm action={unconfirmLead} successMessage="Confirmation removed">
            <input type="hidden" name="leadId" value={lead.id} />
            <button type="submit">Undo confirm</button>
          </ActionForm>
        ) : (
          <>
            <ActionForm action={confirmLead} successMessage="Confirmed">
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="method" value="dm" />
              <button type="submit">Confirmed · DM</button>
            </ActionForm>
            <ActionForm action={confirmLead} successMessage="Confirmed">
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="method" value="phone" />
              <button type="submit">Confirmed · call</button>
            </ActionForm>
          </>
        )}

        {/* Triage always goes through the notes box rather than being a bare
            toggle: the notes are the handoff, and a call marked triaged with
            nothing written tells the closer they're briefed when they aren't. */}
        <a className={`btn${lead.triaged ? '' : ' btn-primary'}`} href={`/leads/${lead.id}#triage`}>
          {lead.triaged ? 'Edit triage' : 'Triage'}
        </a>
      </div>

      <div className="tile-assign">
        {unclaimed ? (
          <ActionForm action={claimLead} successMessage="Claimed">
            <input type="hidden" name="leadId" value={lead.id} />
            {/* Booked straight off a link with no DM behind it - nobody owns it
                until someone says so. */}
            <button className="btn-primary" type="submit">
              Claim lead
            </button>
          </ActionForm>
        ) : (
          <ActionForm action={setSetter}>
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor={`setter-${lead.id}`}>Setter</label>
            {/* Submits on change, so reassigning is one interaction not two. */}
            <AutoSubmitSelect
              id={`setter-${lead.id}`}
              name="setterId"
              defaultValue={lead.setterId ?? ''}
              emptyLabel="Unassigned"
              options={setters.map((s) => ({ value: s.id, label: s.name }))}
            />
          </ActionForm>
        )}

        <ActionForm action={setCloser}>
          <input type="hidden" name="leadId" value={lead.id} />
          <label htmlFor={`closer-${lead.id}`}>Closer</label>
          <AutoSubmitSelect
            id={`closer-${lead.id}`}
            name="closerId"
            defaultValue={lead.closerId ?? ''}
            /* Falls back to whoever Calendly said was hosting, so the dropdown
               never looks empty when the closer just isn't a user row yet. */
            emptyLabel={lead.closerName ?? 'Unassigned'}
            options={closers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </ActionForm>
      </div>
    </article>
  );
}
