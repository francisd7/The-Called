import { CopyButton } from '@/components/CopyButton';
import { offerIcon, offerTone } from '@/lib/offerTone';
import type { offers } from '@/db/schema';

type Offer = typeof offers.$inferSelect;

/**
 * The three Calendly links as square tiles. Plain links rather than per-lead
 * ones, so a booking made through them is matched back by the Instagram handle
 * the invitee types into the booking form - which is why that question has to
 * stay required on all three event types.
 */
export function BookingLinks({ offers: rows }: { offers: Offer[] }) {
  return (
    <div className="booking-grid">
      {rows.map((o) => (
        <div className={`booking-tile tone-${offerTone(o.key)}`} key={o.id}>
          <span className="booking-icon" aria-hidden="true">
            {offerIcon(o.key)}
          </span>
          <span className="booking-label">{o.label}</span>
          <CopyButton value={o.schedulingUrl} label="Copy link" />
        </div>
      ))}
    </div>
  );
}
