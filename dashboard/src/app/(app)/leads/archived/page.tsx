import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { archivedLead } from "@/lib/leadScope";
import { formatDay } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Everything that has been archived, and the way back.
 *
 * Archiving takes a lead out of every other list, so without this screen it
 * would be gone with no way to check what went or to undo a mistake - which
 * is the difference between archiving and deleting, and the whole reason for
 * the feature being one and not the other.
 */
export default async function ArchivedLeadsPage() {
  const rows = await db
    .select({
      id: leads.id,
      igHandle: leads.igHandle,
      name: leads.name,
      archivedAt: leads.archivedAt,
      by: users.name,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.archivedById))
    .where(archivedLead)
    .orderBy(desc(leads.archivedAt));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Archived</h1>
          <p className="sub">
            Leads somebody took out of the tracker. They are in no list and no
            figure, and nothing on them has been deleted — open one to put it
            back.
          </p>
        </div>
        <a className="btn" href="/leads">
          Lead Tracker
        </a>
      </div>

      {rows.length === 0 ? (
        <p className="empty">Nothing archived.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Archived</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/leads/${r.id}#archive`}>
                    {r.name?.trim() || `@${r.igHandle}`}
                  </a>
                </td>
                <td>{formatDay(r.archivedAt)}</td>
                <td>{r.by ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
