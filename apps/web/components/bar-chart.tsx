export interface BarPoint {
  label: string;
  value: number;
}

/** Minimal monochrome bar chart — no chart library, pure CSS. */
export function BarChart({ points, height = 120 }: { points: BarPoint[]; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  if (points.length === 0) {
    return <div className="text-sm text-zinc-500">No data yet.</div>;
  }
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {points.map((p, i) => (
        <div
          key={i}
          className="group relative flex h-full flex-1 items-end"
          title={`${p.label}: ${p.value}`}
        >
          <div
            className="w-full rounded-sm bg-zinc-300 transition-colors group-hover:bg-zinc-400 dark:bg-zinc-700 dark:group-hover:bg-zinc-500"
            style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
