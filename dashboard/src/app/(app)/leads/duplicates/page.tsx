import { db } from '@/db';
import { ActionForm } from '@/components/ActionForm';
import { formatCallTime, formatDay } from '@/lib/dates';
import { getDuplicateGroups, recentMerges, type DuplicateLead } from '@/lib/duplicates';
import { mergeDuplicate, markNotDuplicates } from '@/lib/duplicateActions';
import { planMerge } from '@/lib/mergePlan';

export const dynamic = 'force-dynamic';

function money(value: string | null): string | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return `$${n.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
}

/**
 * The handful of facts that decide which row somebody wants to keep. Written as
 * short phrases rather than a table of every column: the point is to recognise
 * the conversation, not to audit it. A count of nothing is left out - "0 notes"
 * is a word to read past, not a fact.
 */
function facts(lead: DuplicateLead): string[] {
  const out: string[] = [lead.setterName ?? 'no setter'];
  if (lead.conversationStage) out.push(lead.conversationStage.replace(/_/g, ' '));
  out.push(`started ${formatDay(lead.leadCreatedAt)}`);
  if (lead.noteCount > 0) out.push(lead.noteCount === 1 ? '1 note' : `${lead.noteCount} notes`);
  return out;
}

/**
 * The two facts that actually decide it, pulled out of the sentence and given a
 * colour. Everything else on the card is context; a call and a close are the
 * reasons one of these rows is worth more than the other.
 */
function Marks({ lead }: { lead: DuplicateLead }) {
  const cash = money(lead.cashCollected);
  return (
    <>
      {lead.callBooked && (
        <span className={`pill ${lead.callCancelled ? 'warn' : 'ok'}`}>
          {lead.callScheduledFor ? `call ${formatDay(lead.callScheduledFor)}` : 'booked'}
          {lead.callCancelled ? ' · cancelled' : ''}
        </span>
      )}{' '}
      {lead.closed && <span className="pill ok">closed{cash ? ` ${cash}` : ''}</span>}
    </>
  );
}

export default async function DuplicatesPage() {
  const [groups, merged] = await Promise.all([getDuplicateGroups(db), recentMerges(db)]);
  const rows = groups.reduce((n, g) => n + g.leads.length, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Possible duplicates</h1>
          <p className="sub" style={{ maxWidth: '48rem' }}>
            Two rows carrying one person&apos;s Instagram handle — usually because a second row was
            opened rather than the first one found, so one half holds the conversation and the other
            holds the call that came out of it. Nothing here guesses which is which.
          </p>
        </div>
        <a className="btn" href="/leads">
          Back to leads
        </a>
      </div>

      {groups.length === 0 ? (
        <p className="empty">
          Nothing to sort out. Every handle here belongs to exactly one lead.
        </p>
      ) : (
        <>
          <p className="sub">
            {groups.length === 1 ? '1 handle' : `${groups.length} handles`} across {rows} rows.
            Keeping a row brings across anything it hasn&apos;t got — the booking, the close, the
            notes — and removes the other. Whatever both rows answer, the one you keep wins.
          </p>

          {groups.map((group) => {
            const others = (lead: DuplicateLead) => group.leads.filter((l) => l.id !== lead.id);
            return (
              <div className="card" key={group.handleKey}>
                <div className="card-head">
                  <strong>@{group.handleKey}</strong>
                  <span className="card-meta">{group.leads.length} rows</span>
                </div>

                <div className="dupes">
                  {group.leads.map((lead) => {
                    // Union rather than a running total: with two rows, which is
                    // nearly all of them, they are the same thing, and the merge
                    // itself applies them one at a time so a third row still
                    // lands correctly.
                    const brings = [
                      ...new Set(others(lead).flatMap((o) => planMerge(lead, o).brings)),
                    ];
                    return (
                      <div className="dupe" key={lead.id}>
                        <a className="card-title" href={`/leads/${lead.id}`}>
                          {lead.igHandle}
                        </a>
                        <p className="card-meta" style={{ margin: '0.25rem 0 0.4rem' }}>
                          {facts(lead).join(' · ')}
                        </p>
                        <p style={{ margin: '0 0 0.55rem' }}>
                          <Marks lead={lead} />
                          {lead.airtableRecordId && (
                            <span className="pill">from the tracker</span>
                          )}
                        </p>

                        <ActionForm action={mergeDuplicate}>
                          <input type="hidden" name="keepId" value={lead.id} />
                          {others(lead).map((o) => (
                            <input key={o.id} type="hidden" name="dropId" value={o.id} />
                          ))}
                          <button className="btn-primary" type="submit">
                            Keep this one
                          </button>
                        </ActionForm>

                        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
                          {brings.length === 0
                            ? 'Nothing on the other row that this one is missing.'
                            : `Also brings across: ${brings.join(', ')}.`}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="card-row">
                  <ActionForm action={markNotDuplicates}>
                    {group.leads.map((l) => (
                      <input key={l.id} type="hidden" name="leadId" value={l.id} />
                    ))}
                    <button type="submit">Not the same person</button>
                  </ActionForm>
                </div>
              </div>
            );
          })}
        </>
      )}

      {merged.length > 0 && (
        <>
          <h2>Already merged</h2>
          <p className="sub">
            A merge removes the row it was asked about, so this is the only place that says what
            happened to it. The lead it went into keeps the same note in its own history.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row removed</th>
                  <th>Folded into</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((m) => (
                  <tr key={m.id}>
                    <td>{m.mergedIgHandle ?? '\u2014'}</td>
                    <td>
                      <a href={`/leads/${m.keptLeadId}`}>{m.keptIgHandle ?? 'the lead kept'}</a>
                    </td>
                    <td>{m.byName ?? '\u2014'}</td>
                    <td>{formatCallTime(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
