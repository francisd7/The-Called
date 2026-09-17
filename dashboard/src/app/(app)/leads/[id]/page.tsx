import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { CopyButton } from '@/components/CopyButton';
import { addNote, confirmLead, logFollowUp, saveTriage, unconfirmLead, updateLead } from '@/lib/actions';
import { buildTrackedBookingUrl } from '@/lib/bookingLink';
import { formatCallTime, formatDay } from '@/lib/dates';
import { getActiveOffers, getLead, getOptions, getSetters } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** Date input values are plain YYYY-MM-DD, with no timezone of their own. */
function dateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : '';
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getLead(id);
  if (!data) notFound();

  const { lead, setter, offer, notes } = data;
  const [offers, setters, stages, qualities, sources, icps] = await Promise.all([
    getActiveOffers(),
    getSetters(),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
    getOptions('lead_source'),
    getOptions('icp'),
  ]);

  const hasLiveCall = lead.callBooked && !lead.callCancelled;

  return (
    <>
      <p className="sub">
        <a href="/leads">← All leads</a>
      </p>
      <h1>{lead.name?.trim() || `@${lead.igHandle}`}</h1>
      <p className="sub">
        @{lead.igHandle}
        {setter ? ` · ${setter.name}` : ' · unassigned'}
        {lead.phone ? ` · ${lead.phone}` : ''}
        {lead.email ? ` · ${lead.email}` : ''}
      </p>

      {hasLiveCall && (
        <div className="card">
          <div className="card-head">
            <strong>Call booked</strong>
            <span className="card-meta">{formatCallTime(lead.callScheduledFor)}</span>
          </div>
          <div className="card-meta">
            {offer?.label ?? 'Offer unknown'}
            {lead.closerName ? ` · with ${lead.closerName}` : ''}
          </div>
          <div className="card-row">
            <span className={`pill ${lead.confirmed ? 'ok' : 'warn'}`}>
              {lead.confirmed
                ? `✓ Confirmed${lead.confirmationMethod ? ` (${lead.confirmationMethod})` : ''}`
                : 'Not confirmed'}
            </span>
            <span className={`pill ${lead.triaged ? 'ok' : 'warn'}`}>
              {lead.triaged ? '✓ Triaged' : 'Not triaged'}
            </span>
            {lead.calendlyRescheduleUrl && (
              <a className="btn" href={lead.calendlyRescheduleUrl} target="_blank" rel="noreferrer">
                Reschedule
              </a>
            )}
          </div>
          <div className="card-row">
            {lead.confirmed ? (
              <ActionForm action={unconfirmLead} successMessage="Confirmation removed">
                <input type="hidden" name="leadId" value={lead.id} />
                <button type="submit">Undo confirmation</button>
              </ActionForm>
            ) : (
              <>
                <ActionForm action={confirmLead} successMessage="Confirmed">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <input type="hidden" name="method" value="dm" />
                  <button type="submit">Confirmed in DMs</button>
                </ActionForm>
                <ActionForm action={confirmLead} successMessage="Confirmed">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <input type="hidden" name="method" value="phone" />
                  <button type="submit">Confirmed by phone</button>
                </ActionForm>
              </>
            )}
          </div>
        </div>
      )}

      {lead.callCancelled && (
        <div className="card">
          <strong>Call cancelled</strong>
          <div className="card-meta">
            {formatDay(lead.callCancelledAt)}
            {lead.cancelReason ? ` · ${lead.cancelReason}` : ''}
          </div>
        </div>
      )}

      <h2 id="triage">Triage notes</h2>
      <p className="sub">
        Saving this posts the pre-call brief straight to Discord — that&apos;s how Nigel and Andrew
        get it, so write it for them.
      </p>
      <div className="card">
        <ActionForm action={saveTriage} successMessage="Triaged and posted to Discord">
          <input type="hidden" name="leadId" value={lead.id} />
          <div className="field">
            <textarea
              name="triageNotes"
              defaultValue={lead.triageNotes ?? ''}
              placeholder={
                'What do they actually want?\nWhat have they tried?\nWhat is their budget situation?\nAnything the closer should not step on?'
              }
            />
          </div>
          <button className="btn-primary" type="submit">
            {lead.triaged ? 'Update & repost to Discord' : 'Mark triaged & post to Discord'}
          </button>
        </ActionForm>
      </div>

      {!hasLiveCall && (
        <>
          <h2>Send a booking link</h2>
          <p className="sub">
            These carry this lead&apos;s id, so the booking flags itself automatically. A generic
            link copied from Calendly won&apos;t.
          </p>
          {offers.map((o) => (
            <div className="card" key={o.id}>
              <div className="card-head">
                <strong>{o.label}</strong>
              </div>
              <div className="card-row">
                <CopyButton
                  value={buildTrackedBookingUrl(o.schedulingUrl, lead.id, setter?.name)}
                  label={`Copy ${o.key.replace(/_/g, ' ')} link`}
                />
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Notes</h2>
      <div className="card">
        <ActionForm action={addNote} successMessage="Note added">
          <input type="hidden" name="leadId" value={lead.id} />
          <div className="field">
            <textarea name="body" placeholder="What happened in the conversation?" required />
          </div>
          <div className="card-row">
            <button className="btn-primary" type="submit">
              Add note
            </button>
          </div>
        </ActionForm>
      </div>

      {notes.length === 0 ? (
        <p className="empty">No notes yet.</p>
      ) : (
        notes.map((note) => (
          <div className="note" key={note.id}>
            <div className="note-meta">
              {note.authorName} · {formatDay(note.createdAt)}
            </div>
            <div className="note-body">{note.body}</div>
          </div>
        ))
      )}

      <h2>Follow-up</h2>
      <div className="card">
        <ActionForm action={logFollowUp} successMessage="Follow-up logged">
          <input type="hidden" name="leadId" value={lead.id} />
          <div className="field">
            <label htmlFor="nextFollowUpAt">Next follow-up</label>
            <input
              id="nextFollowUpAt"
              name="nextFollowUpAt"
              type="date"
              defaultValue={dateInputValue(lead.nextFollowUpAt)}
            />
          </div>
          <button type="submit">Log follow-up ({lead.followUps} so far)</button>
        </ActionForm>
      </div>

      <h2>Details</h2>
      <div className="card">
        <ActionForm action={updateLead} successMessage="Saved">
          <input type="hidden" name="leadId" value={lead.id} />
          <div className="grid2">
            <div className="field">
              <label htmlFor="igHandle">IG handle</label>
              <input id="igHandle" name="igHandle" defaultValue={lead.igHandle} />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" defaultValue={lead.name ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="tel" defaultValue={lead.phone ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" defaultValue={lead.email ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="setterId">Setter</label>
              <select id="setterId" name="setterId" defaultValue={lead.setterId ?? ''}>
                <option value="">Unassigned</option>
                {setters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="conversationStage">Stage</label>
              <select
                id="conversationStage"
                name="conversationStage"
                defaultValue={lead.conversationStage ?? ''}
              >
                <option value="">—</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="leadQuality">Quality</label>
              <select id="leadQuality" name="leadQuality" defaultValue={lead.leadQuality ?? ''}>
                <option value="">—</option>
                {qualities.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="leadSource">Source</label>
              <select id="leadSource" name="leadSource" defaultValue={lead.leadSource ?? ''}>
                <option value="">—</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="icp">ICP</label>
              <select id="icp" name="icp" defaultValue={lead.icp ?? ''}>
                <option value="">—</option>
                {icps.map((s) => (
                  <option key={s.id} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nextFollowUpAtEdit">Next follow-up</label>
              <input
                id="nextFollowUpAtEdit"
                name="nextFollowUpAt"
                type="date"
                defaultValue={dateInputValue(lead.nextFollowUpAt)}
              />
            </div>
          </div>
          <button className="btn-primary" type="submit">
            Save details
          </button>
        </ActionForm>
      </div>

      {(lead.closed || lead.postCallNotes) && (
        <>
          <h2>Outcome</h2>
          <div className="card">
            <div className="card-row">
              {lead.qualified && <span className="pill ok">Qualified</span>}
              {lead.closed && <span className="pill ok">Closed</span>}
              {lead.contractValue && <span className="pill">Contract ${lead.contractValue}</span>}
              {lead.cashCollected && <span className="pill">Collected ${lead.cashCollected}</span>}
              {lead.lostReason && <span className="pill danger">{lead.lostReason}</span>}
            </div>
            {lead.postCallNotes && <div className="note-body" style={{ marginTop: '0.6rem' }}>{lead.postCallNotes}</div>}
          </div>
        </>
      )}
    </>
  );
}
