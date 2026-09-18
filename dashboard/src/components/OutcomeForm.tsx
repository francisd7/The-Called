'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/ActionForm';
import { logCallOutcome } from '@/lib/outcomeActions';
import type { leads, optionSets } from '@/db/schema';

type Lead = typeof leads.$inferSelect;
type Option = typeof optionSets.$inferSelect;

/**
 * The money fields only make sense for a close, so they appear when one is
 * picked rather than sitting there inviting a number on a no-show.
 */
export function OutcomeForm({
  lead,
  outcomes,
  tiers,
  payments,
  lostReasons,
}: {
  lead: Lead;
  outcomes: Option[];
  tiers: Option[];
  payments: Option[];
  lostReasons: Option[];
}) {
  const [outcome, setOutcome] = useState(lead.callOutcome ?? '');
  const closed = outcome === 'closed';
  const didNotClose = outcome === 'no_close';

  return (
    <ActionForm action={logCallOutcome} successMessage="Saved">
      <input type="hidden" name="leadId" value={lead.id} />

      <div className="field">
        <label htmlFor="callOutcome">What happened? *</label>
        <select
          id="callOutcome"
          name="callOutcome"
          required
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {outcomes.map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {closed && (
        <div className="grid2">
          <div className="field">
            <label htmlFor="contractValue">Contract value *</label>
            <input
              id="contractValue"
              name="contractValue"
              inputMode="decimal"
              required
              defaultValue={lead.contractValue ?? ''}
              placeholder="10000"
            />
          </div>
          <div className="field">
            <label htmlFor="cashCollected">Cash collected today</label>
            <input
              id="cashCollected"
              name="cashCollected"
              inputMode="decimal"
              defaultValue={lead.cashCollected ?? ''}
              placeholder="5000"
            />
          </div>
          <div className="field">
            <label htmlFor="tier">Tier</label>
            <select id="tier" name="tier" defaultValue={lead.tier ?? ''}>
              <option value="">—</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="paymentMethod">Payment method</label>
            <select id="paymentMethod" name="paymentMethod" defaultValue={lead.paymentMethod ?? ''}>
              <option value="">—</option>
              {payments.map((pm) => (
                <option key={pm.id} value={pm.value}>
                  {pm.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {didNotClose && (
        <div className="field">
          <label htmlFor="lostReason">Why not?</label>
          <select id="lostReason" name="lostReason" defaultValue={lead.lostReason ?? ''}>
            <option value="">—</option>
            {lostReasons.map((r) => (
              <option key={r.id} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="postCallNotes">Notes</label>
        <textarea
          id="postCallNotes"
          name="postCallNotes"
          rows={4}
          defaultValue={lead.postCallNotes ?? ''}
          placeholder="What was said, what they committed to, what to do next."
        />
      </div>
      <div className="field">
        <label htmlFor="fathomUrl">Fathom recording</label>
        <input
          id="fathomUrl"
          name="fathomUrl"
          type="url"
          defaultValue={lead.fathomUrl ?? ''}
          placeholder="https://fathom.video/share/…"
        />
      </div>

      <div className="card-row">
        <button className="btn-primary" type="submit">
          {lead.outcomeLoggedAt ? 'Update outcome' : 'Log outcome'}
        </button>
      </div>
    </ActionForm>
  );
}
