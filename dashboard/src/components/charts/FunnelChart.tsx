/**
 * Magnitude, low to high - so one hue getting lighter down the funnel, not a
 * categorical palette. The steps aren't separate identities; they're the same
 * quantity shrinking.
 */
export function FunnelChart({ steps }: { steps: Array<{ step: string; value: number }> }) {
  const max = Math.max(1, ...steps.map((s) => s.value));

  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const rate = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <div className="funnel-row" key={s.step}>
            <div className="funnel-label">{s.step}</div>
            <div className="funnel-track">
              <div
                className="funnel-bar"
                style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%`, opacity: 1 - i * 0.13 }}
              />
              <span className="funnel-value">{s.value.toLocaleString()}</span>
            </div>
            {/* The step-to-step rate is what people actually want; bar lengths
                alone make it guesswork. */}
            <div className="funnel-rate">{rate === null ? '—' : `${rate}%`}</div>
          </div>
        );
      })}
    </div>
  );
}
