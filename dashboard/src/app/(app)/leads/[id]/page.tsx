import { notFound } from 'next/navigation';
import { SetterBadge } from '@/components/SetterBadge';
import { OutcomeForm } from '@/components/OutcomeForm';
import { ActionForm } from '@/components/ActionForm';
import {
  addNote,
  confirmLead,
  logBooking,
  logFollowUp,
  saveTriage,
  unconfirmLead,
  updateLead,
} from '@/lib/actions';
import { formatCallTime, formatDay, teamDateTimeInputValue } from '@/lib/dates';
import { getActiveOffers, getClosers, getLead, getOptions, getSetters } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** Date input values are plain YYYY-MM-DD, with no timezone of their own. */
function dateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : '';
}


export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Postgres rejects a malformed uuid with a driver error, which surfaced as a
  // 500 rather than a 404 for any mistyped or stale link.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const data = await getLead(id);
  if (!data) notFound();

  const { lead, setter, offer, notes } = data;
  const [
    setters,
    stages,
    qualities,
    sources,
    icps,
    outcomes,
    tiers,
    payments,
    lostReasons,
    closers,
    offers,
  ] = await Promise.all([
    getSetters(),
    getOptions('conversation_stage'),
    getOptions('lead_quality'),
    getOptions('lead_source'),
    getOptions('icp'),
    getOptions('call_outcome'),
    getOptions('tier'),
    getOptions('payment_method'),
    getOptions('lost_reason'),
    getClosers(),
    getActiveOffers(),
  ]);

  // Only once the call has actually happened - an outcome form on a call that
  // is still hours away is just noise.
  const callIsPast =
    lead.callBooked &&
    lead.callScheduledFor !== null &&
    lead.callScheduledFor.getTime() < Date.now();

  const hasLiveCall = lead.callBooked && !lead.callCancelled;

  // Stored verbatim from the booking webhook, so treat every field as
  // optional rather than trusting a shape.
  const bookingAnswers = Array.isArray(lead.calendlyAnswers)
    ? (lead.calendlyAnswers as Array<{ question?: string; answer?: string }>)
        .filter((qa) => qa?.question)
        .map((qa) => ({ question: String(qa.question), answer: qa.answer ? String(qa.answer) : '' }))
    : [];

  return (
    <>
      <p className="sub">
        <a href="/leads">← All leads</a>
      </p>
      <h1>@{lead.igHandle}</h1>
      {lead.needsHandle && (
        <div className="card card-attention">
          <strong>This lead has no Instagram handle</strong>
          <p className="sub" style={{ margin: '0.3rem 0 0' }}>
            It came from the Airtable Post Call table, which records a name and nothing else. Put
            the real handle in under Details and this notice goes away.
          </p>
        </div>
      )}
      {lead.isTest && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <strong>This is a test lead</strong>
          <p className="sub" style={{ margin: '0.3rem 0 0' }}>
            Nothing here reaches Discord — triage it, confirm it, add notes, and no one is pinged.
            Admin → Setup has a button to delete it when you&apos;re done.
          </p>
        </div>
      )}
      <p className="sub lead-subline">
        {lead.name?.trim() && <span>{lead.name.trim()}</span>}
        <SetterBadge name={setter?.name} color={setter?.color} />
        {lead.phone && <span>{lead.phone}</span>}
        {lead.email && <span>{lead.email}</span>}
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

      {bookingAnswers.length > 0 && (
        <>
          <h2>What they said when booking</h2>
          <p className="sub">Straight from the Calendly form — read this before you call them.</p>
          <div className="card">
            {bookingAnswers.map((qa, i) => (
              <div key={i} className="note" style={{ marginBottom: i === bookingAnswers.length - 1 ? 0 : '0.9rem' }}>
                <div className="note-meta">{qa.question}</div>
                <div className="note-body">{qa.answer || '—'}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 id="triage">Triage notes</h2>
      <p className="sub">
        {lead.isTest
          ? 'On a real lead this posts the brief straight to Discord. On this test lead it saves and posts nothing.'
          : "Saving this posts the pre-call brief straight to Discord — that's how Nigel and Andrew get it, so write it for them."}
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






      {/* Calendly writes most bookings. This is for the ones it never saw: a
          call booked before the dashboard existed, or one a setter never
          entered. Without it there is no way to record a booking at all. */}
      {!lead.calendlyEventUri && (
        <>
          <h2 id="booking">{lead.callBooked ? 'Booked call' : 'Was a call booked?'}</h2>
          <p className="sub">
            {lead.callBooked
              ? 'Entered by hand rather than by Calendly, so it can be corrected here.'
              : 'Calendly never sent a booking for this lead. If a call happened anyway, record it here and it counts in the funnel.'}
          </p>
          <div className="card">
            <ActionForm action={logBooking} successMessage="Booking recorded">
              <input type="hidden" name="leadId" value={lead.id} />
              <div className="grid2">
                <div className="field">
                  <label htmlFor="callScheduledFor">Call date &amp; time (ET) *</label>
                  <input
                    id="callScheduledFor"
                    name="callScheduledFor"
                    type="datetime-local"
                    required
                    defaultValue={teamDateTimeInputValue(lead.callScheduledFor)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="closerId">Closer</label>
                  <select id="closerId" name="closerId" defaultValue={lead.closerId ?? ''}>
                    <option value="">&mdash;</option>
                    {closers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="offerId">Offer</label>
                  <select id="offerId" name="offerId" defaultValue={lead.offerId ?? ''}>
                    <option value="">&mdash;</option>
                    {offers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit">
                {lead.callBooked ? 'Update booking' : 'Record this booking'}
              </button>
            </ActionForm>
          </div>
        </>
      )}

      {(callIsPast || lead.outcomeLoggedAt) && (
        <>
          <h2 id="outcome">Call outcome</h2>
          <p className="sub">
            {lead.outcomeLoggedAt
              ? 'Recorded after the call. Saving again updates it and reposts to Discord.'
              : "This call has been and gone. Logging what happened is what keeps the funnel's bottom half honest."}
          </p>
          <div className={`card${lead.outcomeLoggedAt ? '' : ' card-attention'}`}>
            <OutcomeForm
              lead={lead}
              outcomes={outcomes}
              tiers={tiers}
              payments={payments}
              lostReasons={lostReasons}
            />
          </div>
        </>
      )}
    </>
  );
}
