import { asc, desc } from 'drizzle-orm';
import { db } from '@/db';
import { boostedReels } from '@/db/schema';
import { currentUser } from '@/lib/session';
import { ActionForm } from '@/components/ActionForm';
import { addReel, deleteReel, updateReel } from '@/lib/reelActions';
import { embedUrl, permalink, reelMetrics, summariseReels, REEL_STATUSES } from '@/lib/reelMetrics';

export const dynamic = 'force-dynamic';

type Reel = typeof boostedReels.$inferSelect;

const n0 = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US'));

function money(v: number | null, currency: string, digits = 0) {
  if (v === null) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

/**
 * The preview.
 *
 * Instagram's own embed, which is the only way to show a real post without a
 * Meta app and an access token. It has a hard minimum width of 326px, so at
 * tile size it is scaled down rather than squeezed - squeezing is what makes
 * an embed render with its own scrollbars.
 *
 * Lazy, because five of these is five Instagram pages, and pointer-events off,
 * because a click should open the reel rather than land inside the iframe.
 */
function Preview({ reel }: { reel: Reel }) {
  if (!reel.shortcode) {
    return (
      <div className="reel-preview reel-preview-none">
        <span>{reel.reelUrl ? 'Link not recognised' : 'No link yet'}</span>
      </div>
    );
  }

  return (
    <a
      className="reel-preview"
      href={permalink(reel.shortcode)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${reel.title} on Instagram`}
    >
      {/* Sits behind the iframe rather than instead of it. Instagram's embed
          paints its own white background once it loads, covering this; when it
          does not - a private post, a browser blocking third-party frames -
          the tile still says what it is and where to go, instead of being an
          empty grey rectangle. */}
      <span className="reel-preview-fallback">
        <span className="reel-preview-title">{reel.title}</span>
        <span className="reel-preview-cta">Open on Instagram &rarr;</span>
      </span>
      <iframe
        src={embedUrl(reel.shortcode)}
        title={reel.title}
        loading="lazy"
        scrolling="no"
        allowFullScreen
      />
      <span className="reel-preview-hit" />
    </a>
  );
}

/** One number and its label, for the face of a tile. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="reel-figure">
      <span className="reel-figure-n">{value}</span>
      <span className="reel-figure-l">{label}</span>
    </div>
  );
}

function ReelForm({ reel, canEdit }: { reel?: Reel; canEdit: boolean }) {
  const d = reel;
  return (
    <div className="grid2">
      <div className="field">
        <label htmlFor={`title-${d?.id ?? 'new'}`}>Name *</label>
        <input id={`title-${d?.id ?? 'new'}`} name="title" defaultValue={d?.title ?? ''} required />
      </div>
      <div className="field">
        <label htmlFor={`reelUrl-${d?.id ?? 'new'}`}>Instagram link</label>
        <input
          id={`reelUrl-${d?.id ?? 'new'}`}
          name="reelUrl"
          defaultValue={d?.reelUrl ?? ''}
          placeholder="https://www.instagram.com/reel/…"
        />
      </div>
      <div className="field">
        <label htmlFor={`hook-${d?.id ?? 'new'}`}>Hook</label>
        <input
          id={`hook-${d?.id ?? 'new'}`}
          name="hook"
          defaultValue={d?.hook ?? ''}
          placeholder="The opening line"
        />
      </div>
      <div className="field">
        <label htmlFor={`status-${d?.id ?? 'new'}`}>Status</label>
        <select id={`status-${d?.id ?? 'new'}`} name="status" defaultValue={d?.status ?? 'running'}>
          {REEL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`postedOn-${d?.id ?? 'new'}`}>Posted</label>
        <input id={`postedOn-${d?.id ?? 'new'}`} name="postedOn" type="date" defaultValue={d?.postedOn ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`sortOrder-${d?.id ?? 'new'}`}>Order on the page</label>
        <input id={`sortOrder-${d?.id ?? 'new'}`} name="sortOrder" type="number" defaultValue={d?.sortOrder ?? 0} />
      </div>
      <div className="field">
        <label htmlFor={`boostStartedOn-${d?.id ?? 'new'}`}>Boost started</label>
        <input id={`boostStartedOn-${d?.id ?? 'new'}`} name="boostStartedOn" type="date" defaultValue={d?.boostStartedOn ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`boostEndedOn-${d?.id ?? 'new'}`}>Boost ended</label>
        <input id={`boostEndedOn-${d?.id ?? 'new'}`} name="boostEndedOn" type="date" defaultValue={d?.boostEndedOn ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`spend-${d?.id ?? 'new'}`}>Spend</label>
        <input id={`spend-${d?.id ?? 'new'}`} name="spend" inputMode="decimal" defaultValue={d?.spend ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`spendCurrency-${d?.id ?? 'new'}`}>Spend currency</label>
        <select id={`spendCurrency-${d?.id ?? 'new'}`} name="spendCurrency" defaultValue={d?.spendCurrency ?? 'USD'}>
          <option value="USD">USD</option>
          <option value="CAD">CAD</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor={`views-${d?.id ?? 'new'}`}>Views</label>
        <input id={`views-${d?.id ?? 'new'}`} name="views" inputMode="numeric" defaultValue={d?.views ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`reach-${d?.id ?? 'new'}`}>Accounts reached</label>
        <input id={`reach-${d?.id ?? 'new'}`} name="reach" inputMode="numeric" defaultValue={d?.reach ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`likes-${d?.id ?? 'new'}`}>Likes</label>
        <input id={`likes-${d?.id ?? 'new'}`} name="likes" inputMode="numeric" defaultValue={d?.likes ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`comments-${d?.id ?? 'new'}`}>Comments</label>
        <input id={`comments-${d?.id ?? 'new'}`} name="comments" inputMode="numeric" defaultValue={d?.comments ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`shares-${d?.id ?? 'new'}`}>Shares</label>
        <input id={`shares-${d?.id ?? 'new'}`} name="shares" inputMode="numeric" defaultValue={d?.shares ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`saves-${d?.id ?? 'new'}`}>Saves</label>
        <input id={`saves-${d?.id ?? 'new'}`} name="saves" inputMode="numeric" defaultValue={d?.saves ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`profileVisits-${d?.id ?? 'new'}`}>Profile visits</label>
        <input id={`profileVisits-${d?.id ?? 'new'}`} name="profileVisits" inputMode="numeric" defaultValue={d?.profileVisits ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`followsGained-${d?.id ?? 'new'}`}>Follows gained</label>
        <input id={`followsGained-${d?.id ?? 'new'}`} name="followsGained" inputMode="numeric" defaultValue={d?.followsGained ?? ''} />
      </div>

      <div className="field">
        <label htmlFor={`leadsGenerated-${d?.id ?? 'new'}`}>Conversations started</label>
        <input id={`leadsGenerated-${d?.id ?? 'new'}`} name="leadsGenerated" inputMode="numeric" defaultValue={d?.leadsGenerated ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`callsBooked-${d?.id ?? 'new'}`}>Calls booked</label>
        <input id={`callsBooked-${d?.id ?? 'new'}`} name="callsBooked" inputMode="numeric" defaultValue={d?.callsBooked ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`closes-${d?.id ?? 'new'}`}>Closes</label>
        <input id={`closes-${d?.id ?? 'new'}`} name="closes" inputMode="numeric" defaultValue={d?.closes ?? ''} />
      </div>
      <div className="field">
        <label htmlFor={`cashCollected-${d?.id ?? 'new'}`}>Cash collected</label>
        <input id={`cashCollected-${d?.id ?? 'new'}`} name="cashCollected" inputMode="decimal" defaultValue={d?.cashCollected ?? ''} />
      </div>
      <div className="field field-wide">
        <label htmlFor={`notes-${d?.id ?? 'new'}`}>Notes</label>
        <textarea id={`notes-${d?.id ?? 'new'}`} name="notes" rows={2} defaultValue={d?.notes ?? ''} />
      </div>
      <div className="field field-wide">
        <button type="submit" disabled={!canEdit}>
          {d ? 'Save changes' : 'Add reel'}
        </button>
      </div>
    </div>
  );
}

export default async function DataPage() {
  const me = await currentUser();
  const canEdit = me?.role === 'admin' && !me?.viewingAs;

  const reels = await db
    .select()
    .from(boostedReels)
    .orderBy(asc(boostedReels.sortOrder), desc(boostedReels.createdAt));

  const totals = summariseReels(reels);

  return (
    <>
      <h1>Data</h1>
      <p className="sub">
        Boosted reels and what each one returned. Cost per lead, return and the
        rates below are worked out from the numbers on the right, so there is
        nothing to keep in step by hand.
      </p>

      {totals.map((t) => (
        <div key={t.currency} className="stats">
          <div className="stat tone-blue">
            <div className="stat-n">{money(t.spend, t.currency)}</div>
            <div className="stat-l">spent{totals.length > 1 ? ` (${t.currency})` : ''}</div>
          </div>
          <div className="stat tone-green">
            <div className="stat-n">{money(t.cash, t.currency)}</div>
            <div className="stat-l">cash collected</div>
          </div>
          <div className={`stat ${t.net >= 0 ? 'tone-green' : 'tone-amber'}`}>
            <div className="stat-n">{money(t.net, t.currency)}</div>
            <div className="stat-l">net</div>
          </div>
          <div className="stat tone-violet">
            <div className="stat-n">{money(t.costPerLead, t.currency, 2)}</div>
            <div className="stat-l">per conversation</div>
          </div>
          <div className="stat tone-violet">
            <div className="stat-n">{money(t.costPerCall, t.currency, 2)}</div>
            <div className="stat-l">per call booked</div>
          </div>
          <div className="stat tone-green">
            <div className="stat-n">{t.roas === null ? '—' : `${t.roas.toFixed(1)}×`}</div>
            <div className="stat-l">return on spend</div>
          </div>
        </div>
      ))}
      {totals.length > 1 && (
        <p className="sub">
          Totalled separately per currency. Adding {totals.map((t) => t.currency).join(' and ')}{' '}
          together would give a cost per lead that is not a figure in either.
        </p>
      )}

      {reels.length === 0 ? (
        <p className="empty">
          No reels yet.{' '}
          {canEdit ? 'Add the first one below.' : 'Francis adds these on the Data page.'}
        </p>
      ) : (
        <div className="reel-grid">
          {reels.map((reel) => {
            const m = reelMetrics(reel);
            const cur = reel.spendCurrency;
            return (
              <article key={reel.id} className={`reel-tile reel-${reel.status}`}>
                <Preview reel={reel} />
                <div className="reel-body">
                  <h3>{reel.title}</h3>
                  {/* Always rendered, even when empty: the reserved space is
                      what keeps the numbers in a row level with each other. */}
                  <p className="reel-hook">{reel.hook ? `“${reel.hook}”` : ''}</p>
                  <span className={`reel-status reel-status-${reel.status}`}>{reel.status}</span>

                  <div className="reel-figures">
                    <Figure label="spend" value={money(reel.spend === null ? null : Number(reel.spend), cur)} />
                    <Figure label="cash in" value={money(reel.cashCollected === null ? null : Number(reel.cashCollected), cur)} />
                    <Figure label="per lead" value={money(m.costPerLead, cur, 2)} />
                    <Figure label="per call" value={money(m.costPerCall, cur, 2)} />
                    <Figure label="return" value={m.roas === null ? '—' : `${m.roas.toFixed(1)}×`} />
                    <Figure label="views" value={n0(reel.views)} />
                    <Figure label="convos" value={n0(reel.leadsGenerated)} />
                    <Figure label="calls" value={n0(reel.callsBooked)} />
                    <Figure label="closes" value={n0(reel.closes)} />
                  </div>

                  {reel.notes && <p className="reel-notes">{reel.notes}</p>}

                  {canEdit && (
                    <details className="reel-edit">
                      <summary>Edit numbers</summary>
                      <ActionForm action={updateReel} successMessage="Saved">
                        <input type="hidden" name="id" value={reel.id} />
                        <ReelForm reel={reel} canEdit={canEdit} />
                      </ActionForm>
                      <ActionForm action={deleteReel} successMessage="Removed">
                        <input type="hidden" name="id" value={reel.id} />
                        <button type="submit" className="danger-link">
                          Remove this reel
                        </button>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {reels.length > 0 && (
        <>
          <h2>Side by side</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reel</th>
                  <th>Status</th>
                  <th>Spend</th>
                  <th>Views</th>
                  <th>Reach</th>
                  <th>Eng.</th>
                  <th>Convos</th>
                  <th>Calls</th>
                  <th>Closes</th>
                  <th>Per lead</th>
                  <th>Per call</th>
                  <th>Cash in</th>
                  <th>Net</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                {reels.map((reel) => {
                  const m = reelMetrics(reel);
                  const cur = reel.spendCurrency;
                  return (
                    <tr key={reel.id}>
                      <td>
                        {reel.shortcode ? (
                          <a href={permalink(reel.shortcode)} target="_blank" rel="noreferrer">
                            {reel.title}
                          </a>
                        ) : (
                          reel.title
                        )}
                      </td>
                      <td>{reel.status}</td>
                      <td>{money(reel.spend === null ? null : Number(reel.spend), cur)}</td>
                      <td>{n0(reel.views)}</td>
                      <td>{n0(reel.reach)}</td>
                      <td>{pct(m.engagementRate)}</td>
                      <td>{n0(reel.leadsGenerated)}</td>
                      <td>{n0(reel.callsBooked)}</td>
                      <td>{n0(reel.closes)}</td>
                      <td>{money(m.costPerLead, cur, 2)}</td>
                      <td>{money(m.costPerCall, cur, 2)}</td>
                      <td>{money(reel.cashCollected === null ? null : Number(reel.cashCollected), cur)}</td>
                      <td>{money(m.net, cur)}</td>
                      <td>{m.roas === null ? '—' : `${m.roas.toFixed(1)}×`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canEdit && (
        <>
          <h2>Add a reel</h2>
          <div className="card">
            <ActionForm action={addReel} successMessage="Added">
              <ReelForm canEdit={canEdit} />
            </ActionForm>
          </div>
        </>
      )}
    </>
  );
}
