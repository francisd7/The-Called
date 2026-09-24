/**
 * One colour per person, the same everywhere.
 *
 * The tiles used to colour by what the row meant - every active-conversations
 * tile teal, every follow-ups tile violet - so on a screen showing both, Alexis
 * and Loui were the same colour twice and told you nothing. Colour follows the
 * person instead, which is the only thing that makes it readable at a glance.
 *
 * Same five hues the charts use, so somebody is the same colour on the tracker
 * as in the KPI lines.
 */
/**
 * Three hues, none of them used anywhere else in the dashboard.
 *
 * Blue is the accent, green means good, amber means look at this, red means
 * broken, and orange, purple and pink are the chart's own series - so a person
 * wearing any of those reads as a state rather than as themselves. Cyan, lime
 * and magenta were free.
 *
 * Three rather than five: the validator could not separate a fourth from these
 * under red-green colour blindness inside the dark theme's lightness band, and
 * shipping two people nobody can tell apart is worse than wrapping. Validated
 * against both surfaces, all pairs, in scripts/validate_palette.js - the dark
 * steps land in the 6-8 floor band, which is legal because a person's name is
 * always printed next to their colour and never replaced by it.
 */
export const PERSON_COLOURS = ['cyan', 'lime', 'magenta'] as const;
export type PersonColour = (typeof PERSON_COLOURS)[number];

type Person = { id: string; name: string; role: string; active: boolean };

/**
 * The fixed order colours are handed out in.
 *
 * Everyone who can hold a lead, by name - not whoever appears in whatever is
 * on screen, or a filter would repaint the survivors. Closers are left out
 * because they never own a tile and would otherwise spend a slot.
 */
export function colourOrder(people: Person[]): string[] {
  return people
    .filter((p) => p.active && (p.role === 'setter' || p.role === 'admin'))
    .slice()
    .sort(
      (a, b) =>
        // Setters take the first slots. They are the ones on a tile and a chart
        // line every day, and with fewer colours than people it is their pair
        // that has to stay distinct - an admin is the one who can afford to
        // share. Alphabetical within each group so the order never moves.
        Number(a.role === 'admin') - Number(b.role === 'admin') || a.name.localeCompare(b.name)
    )
    .map((p) => p.id);
}

function isColour(v: string | null | undefined): v is PersonColour {
  return !!v && (PERSON_COLOURS as readonly string[]).includes(v);
}

/**
 * A colour set on the person's own record wins, so it can be corrected without
 * a deploy. Otherwise it comes from their place in the order above.
 */
export function personColour(
  person: { id: string; color?: string | null },
  order: string[]
): PersonColour {
  if (isColour(person.color)) return person.color;
  const at = order.indexOf(person.id);
  // Somebody outside the order - a closer, or a person just deactivated - gets
  // the last colour rather than none, which reads as a bug.
  if (at === -1) return PERSON_COLOURS[PERSON_COLOURS.length - 1];
  return PERSON_COLOURS[at % PERSON_COLOURS.length];
}

/** The 1-based chart series slot, from the same order, so the two agree. */
export function toneFor(id: string, order: string[]): number {
  const at = order.indexOf(id);
  return at === -1 ? order.length + 1 : at + 1;
}
