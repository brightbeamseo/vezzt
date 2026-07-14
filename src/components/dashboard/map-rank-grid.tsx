type Props = {
  ranks: unknown;
};

function cellClass(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 3) return "bg-emerald-600 text-white";
    if (value <= 10) return "bg-amber-200 text-amber-950";
    return "bg-neutral-200 text-neutral-800";
  }
  return "bg-neutral-100 text-neutral-400";
}

function cellLabel(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value === "X" || value === "x") return "X";
  if (value == null) return "—";
  return String(value);
}

export function MapRankGrid({ ranks }: Props) {
  if (!Array.isArray(ranks) || ranks.length === 0) {
    return (
      <p className="text-sm text-neutral-500">No rank grid available.</p>
    );
  }

  return (
    <div className="inline-block overflow-x-auto">
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${Array.isArray(ranks[0]) ? ranks[0].length : 1}, minmax(2rem, 2.5rem))`,
        }}
      >
        {ranks.flatMap((row, ri) => {
          if (!Array.isArray(row)) return [];
          return row.map((cell, ci) => (
            <div
              key={`${ri}-${ci}`}
              className={`flex h-9 items-center justify-center rounded text-xs font-semibold tabular-nums ${cellClass(cell)}`}
              title={`Row ${ri + 1}, Col ${ci + 1}: ${cellLabel(cell)}`}
            >
              {cellLabel(cell)}
            </div>
          ));
        })}
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        Green = top 3 · Amber = 4–10 · Gray = 11+ · X = not found
      </p>
    </div>
  );
}
