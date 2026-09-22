/**
 * Which leads a bulk assignment is allowed to move.
 *
 * Its own module because the dangerous case is silent: handing a filtered page
 * to one person must never quietly take a conversation off a colleague who is
 * part-way through it. That is a rule about other people's work, so it is
 * written where it can be read and tested rather than buried in the middle of
 * a server action.
 */

export type Assignable = { id: string; setterId: string | null };

export type AssignPlan = {
  /** Leads to write. */
  moved: string[];
  /** Already belonged to the person being assigned; nothing to do. */
  alreadyTheirs: number;
  /** Somebody else is working these, so they stay where they are. */
  leftAlone: number;
};

/**
 * `roleById` decides what counts as somebody's work. A lead parked with an
 * admin is the imported backlog - 432 rows arrived owned by nobody and were
 * handed to whoever ran the import - so those move freely. A lead held by a
 * setter is a conversation in progress, and it doesn't.
 */
export function planBulkAssign(
  rows: readonly Assignable[],
  setterId: string,
  roleById: ReadonlyMap<string, string>
): AssignPlan {
  const plan: AssignPlan = { moved: [], alreadyTheirs: 0, leftAlone: 0 };

  for (const row of rows) {
    if (row.setterId === setterId) {
      plan.alreadyTheirs += 1;
      continue;
    }
    if (row.setterId !== null && roleById.get(row.setterId) === 'setter') {
      plan.leftAlone += 1;
      continue;
    }
    plan.moved.push(row.id);
  }

  return plan;
}
