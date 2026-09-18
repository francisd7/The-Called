import { CopyButton } from '@/components/CopyButton';
import type { offers } from '@/db/schema';

type Offer = typeof offers.$inferSelect;

/**
 * The three Calendly links, as plain links rather than per-lead ones. A booking
 * made through these carries no lead id, so it's matched back by the Instagram
 * handle the invitee types into the booking form - which is why that question
 * has to stay required on all three event types.
 */
export function BookingLinks({ offers: rows }: { offers: Offer[] }) {
  return (
    <div className="booking-grid">
      {rows.map((o) => (
        <div className="booking-tile" key={o.id}>
          <span className="booking-label">{o.label}</span>
          <CopyButton value={o.schedulingUrl} label="Copy link" />
        </div>
      ))}
    </div>
  );
}
