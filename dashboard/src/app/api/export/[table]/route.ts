import { NextResponse } from 'next/server';
import { desc, getTableColumns } from 'drizzle-orm';
import { db } from '@/db';
import { boostedReels, eodReports, leads, postCallReports, users } from '@/db/schema';
import { currentUser } from '@/lib/session';
import { toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/**
 * Everything in the dashboard, out as CSV.
 *
 * This is the escape hatch. The Airtable tracker stopped being the record of
 * anything weeks ago, so a single Railway database now holds the only copy of
 * the pipeline - and a system with no way to get the data out is one somebody
 * has to be nervous about handing over. It doubles as the way to do a piece of
 * analysis the dashboard does not do.
 *
 * Deliberately raw: every column, no joins collapsed, no rounding. A file that
 * quietly drops columns is worse than no file, because it looks like a backup.
 */
const TABLES = {
  leads: {
    table: leads,
    order: () => desc(leads.createdAt),
    label: 'leads',
  },
  eod: {
    table: eodReports,
    order: () => desc(eodReports.reportDate),
    label: 'eod-reports',
  },
  'post-call': {
    table: postCallReports,
    order: () => desc(postCallReports.createdAt),
    label: 'post-call-reports',
  },
  reels: {
    table: boostedReels,
    order: () => desc(boostedReels.createdAt),
    label: 'boosted-reels',
  },
  people: {
    table: users,
    order: () => users.name,
    label: 'people',
  },
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  // Admin only, and never while viewing as somebody else: this hands over every
  // lead, every note and every figure in one file.
  const me = await currentUser();
  if (!me || me.role !== 'admin' || me.viewingAs) {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  const { table } = await params;
  const spec = TABLES[table as keyof typeof TABLES];
  if (!spec) {
    return NextResponse.json(
      { error: `Unknown export. Try one of: ${Object.keys(TABLES).join(', ')}` },
      { status: 404 }
    );
  }

  const rows = await db.select().from(spec.table).orderBy(spec.order());
  // Columns come off the schema rather than a hand-written list, so a column
  // added later is in the export without anyone remembering to add it here -
  // and off the schema rather than off the first row, so an empty table still
  // exports its header. A blank file reads as a broken export, not an empty one.
  const columns = Object.keys(getTableColumns(spec.table));
  const csv = toCsv(columns, rows as Array<Record<string, unknown>>);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="the-called-${spec.label}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
