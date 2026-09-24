import { NextResponse } from 'next/server';
import { db } from '@/db';
import { currentUser } from '@/lib/session';
import { buildCsv, EXPORTS, fileNameFor, isExportKey } from '@/lib/exports';

export const dynamic = 'force-dynamic';

/**
 * Everything in the dashboard, out as CSV.
 *
 * This is the escape hatch. The Airtable tracker stopped being the record of
 * anything weeks ago, so a single Railway database holds the only live copy of
 * the pipeline. It doubles as the way to do a piece of analysis the dashboard
 * does not do.
 *
 * Deliberately raw: every column, no joins collapsed, no rounding. A file that
 * quietly drops columns is worse than no file, because it looks like a backup.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  // Admin only, and never while viewing as somebody else: this hands over every
  // lead, every note and every figure in one file.
  const me = await currentUser();
  if (!me || me.role !== 'admin' || me.viewingAs) {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  const { table } = await params;
  if (!isExportKey(table)) {
    return NextResponse.json(
      { error: `Unknown export. Try one of: ${Object.keys(EXPORTS).join(', ')}` },
      { status: 404 }
    );
  }

  const csv = await buildCsv(db, table);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileNameFor(table)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
