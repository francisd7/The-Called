/**
 * One colour per offer, used for its booking link and for any call booked
 * through it, so a glance at the calls list says which offer it was. Keyed on
 * the offer's stable key rather than its label, which is editable.
 *
 * Reuses the dashboard tile tones so the app stays one palette rather than two.
 */
export function offerTone(key: string | null | undefined): string {
  switch (key) {
    case 'brotherhood':
      return 'amber';
    case 'personal_branding':
      return 'orange';
    case 'fitness':
      return 'blue';
    default:
      return 'grey';
  }
}

/** A simple glyph per offer - secondary to the colour, never instead of it. */
export function offerIcon(key: string | null | undefined): string {
  switch (key) {
    case 'brotherhood':
      return '\u{1F91D}';
    case 'personal_branding':
      return '\u{1F4E3}';
    case 'fitness':
      return '\u{1F4AA}';
    default:
      return '\u{1F4C5}';
  }
}
