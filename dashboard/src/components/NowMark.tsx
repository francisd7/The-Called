"use client";

import { useEffect, useState } from "react";

/**
 * Where the current time falls on the day strip.
 *
 * Client-only on purpose. Rendering "now" on the server bakes the build or
 * request time into the page, and the whole value of the mark is that it is
 * actually now - a line an hour out is worse than no line, because the calls
 * either side of it look like they have happened or not happened.
 *
 * Outside the strip's hours it renders nothing rather than pinning itself to
 * an end, which would read as "it is 8pm" all evening.
 */
export function NowMark({
  startHour,
  endHour,
}: {
  startHour: number;
  endHour: number;
}) {
  const [at, setAt] = useState<{ fraction: number; label: string } | null>(
    null,
  );

  useEffect(() => {
    const read = () => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "numeric",
        hour12: false,
        timeZone: "America/New_York",
      }).formatToParts(now);
      const get = (t: string) =>
        Number(parts.find((p) => p.type === t)?.value ?? 0);
      const hour = get("hour") % 24;
      const minute = get("minute");
      const decimal = hour + minute / 60;

      if (decimal < startHour || decimal > endHour) return setAt(null);
      setAt({
        fraction: (decimal - startHour) / (endHour - startHour),
        label: new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        }).format(now),
      });
    };

    read();
    // A minute is as precise as the mark claims to be.
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, [startHour, endHour]);

  if (!at) return null;

  return (
    <span
      className="daystrip-now"
      style={{ left: `${at.fraction * 100}%` }}
      aria-label={`Right now, ${at.label}`}
    >
      <span className="daystrip-now-label">now</span>
    </span>
  );
}
