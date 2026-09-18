import type { leads, users } from '@/db/schema';
import { ActionForm } from '@/components/ActionForm';
import { AutoSubmitSelect } from '@/components/AutoSubmitSelect';
import { confirmLead, unconfirmLead } from '@/lib/actions';
import { claimLead, setCloser, setSetter } from '@/lib/assignActions';
import { formatCallTime, formatTimeOnly } from '@/lib/dates';
import { offerIcon, offerTone } from '@/lib/offerTone';

type Lead = typeof leads.$inferSelect;
type Person = typeof users.$inferSelect;

/**
 * A booked call. Everything a setter does before it - confirm, triage, own it,
 * say who's taking it - lives on the tile, so working the day's calls doesn't
 * mean opening and backing out of each one.
 *
 * The tile is toned by the offer it was booked through, so the list reads by
 * offer at a glance. The offer is also named in text; the colour never carries
 * meaning on its own.
 */
export function CallTile({
  lead,
  offerKey,
  offerLabel,
  setters,
  closers,
  showDate = false,
}: {
  lead: Lead;
  offerKey?: string | null;
  offerLabel?: string | null;
  setters: Person[];
  closers: Person[];
  showDate?: boolean;
}) {
  const unclaimed = !lead.setterId;
  const ready = lead.confirmed && lead.triaged;

  return (
    <article className={`tile tone-${offerTone(offerKey)}${unclaimed ? ' tile-unclaimed' : ''}`}>
      <header className="tile-top">
        <span className="tile-when">
          {showDate ? formatCallTime(lead.callScheduledFor) : formatTimeOnly(lead.callScheduledFor)}
        </span>
        {lead.isTest && <span className="pill danger">TEST</span>}
      </header>

      <a className="tile-title" href={`/leads/${lead.id}`}>
        {lead.name?.trim() || `@${lead.igHandle}`}
      </a>
      <div className="tile-sub">
        @{lead.igHandle}
        {lead.phone ? ` · ${lead.phone}` : ''}
      </div>
      {offerLabel && (
        <div className="tile-offer">
          <span aria-hidden="true">{offerIcon(offerKey)}</span> {offerLabel}
        </div>
      )}

      {/* Ready collapses two amber warnings into one green line - the common
          case shouldn't look like two outstanding tasks. */}
      <div className="tile-state">
        {ready ? (
          <span className="pill ok">✓ Confirmed &amp; triaged</span>
        ) : (
          <>
            <span className={`pill ${lead.confirmed ? 'ok' : 'warn'}`}>
              {lead.confirmed ? '✓ Confirmed' : 'Not confirmed'}
            </span>
            <span className={`pill ${lead.triaged ? 'ok' : 'warn'}`}>
              {lead.triaged ? '✓ Triaged' : 'Not triaged'}
            </span>
          </>
        )}
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
              <button type="submit">Confirm · DM</button>
            </ActionForm>
            <ActionForm action={confirmLead} successMessage="Confirmed">
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="method" value="phone" />
              <button type="submit">Confirm · call</button>
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
            <button className="btn-primary" type="submit">
              Claim lead
            </button>
          </ActionForm>
        ) : (
          <ActionForm action={setSetter}>
            <input type="hidden" name="leadId" value={lead.id} />
            <label htmlFor={`setter-${lead.id}`}>Setter</label>
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
            emptyLabel={lead.closerName ?? 'Unassigned'}
            options={closers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </ActionForm>
      </div>
    </article>
  );
}
