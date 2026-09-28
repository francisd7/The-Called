import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getBookedCalls, type CallFilters } from "@/lib/queries";
import { toCsv } from "@/lib/csv";
import { teamDateString, formatTimeOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "date",
  "time",
  "handle",
  "name",
  "setter",
  "closer",
  "offer",
  "confirmed",
  "triaged",
  "status",
  "cancel_reason",
  "outcome",
  "cash_collected",
  "contract_value",
];

/** The same word the page prints, so a row cannot say something the screen does not. */
function status(c: {
  cancelled: boolean;
  settled: boolean;
  showed: boolean | null;
  closed: boolean | null;
}): string {
  if (c.cancelled) return "Cancelled";
  if (!c.settled) return "Waiting";
  if (c.closed) return "Closed";
  if (c.showed === false) return "No show";
  return "No close";
}

/**
 * The Calls page as it is currently filtered, as a CSV.
 *
 * Its own route rather than a key on the whole-table export, because that one
 * hands over a raw table and this one has to honour the setter, closer and
 * date boxes above it - a file that quietly ignored the filters would be the
 * wrong answer to "export what I am looking at".
 *
 * Signed in is enough: this is the page's own rows, and the page is already
 * open to everyone. The raw table dumps stay admin-only.
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const url = new URL(req.url);
  const today = teamDateString();
  const filters: CallFilters = {
    setterId: url.searchParams.get("setterId") || undefined,
    closerId: url.searchParams.get("closerId") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  };

  // Well past the page's own cap: a file that stops at 500 without saying so
  // looks like the pipeline shrank.
  const calls = await getBookedCalls(filters, 10_000);

  const rows = calls.map((c) => ({
    date: c.callScheduledFor ? teamDateString(c.callScheduledFor) : "",
    time: c.callScheduledFor ? formatTimeOnly(c.callScheduledFor) : "",
    handle: c.igHandle,
    name: c.name ?? "",
    setter: c.setterName ?? "",
    closer: c.closerName ?? "",
    offer: c.offerLabel ?? "",
    confirmed: c.confirmed ? "yes" : "no",
    triaged: c.triaged ? "yes" : "no",
    status: status(c),
    cancel_reason: c.cancelReason ?? "",
    outcome: c.callOutcome ?? "",
    // Blank rather than 0, so a call nobody has priced is not read as a nil deal.
    cash_collected: c.cashCollected ?? "",
    contract_value: c.contractValue ?? "",
  }));

  const name = `calls-${filters.from ?? "start"}-to-${filters.to ?? today}.csv`;
  return new NextResponse(toCsv(COLUMNS, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
