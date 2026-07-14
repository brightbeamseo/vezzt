export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Display helper — never invent values for null/undefined scores. */
export function formatNullable(
  value: number | string | null | undefined,
  options?: {
    kind?: "currency" | "number" | "rating" | "percent" | "integer";
    digits?: number;
  },
): string {
  if (value === null || value === undefined || value === "") {
    return "Not calculated";
  }

  const kind = options?.kind ?? "number";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) && kind !== "number") {
    return "Not calculated";
  }

  if (kind === "currency") {
    return formatCurrency(num);
  }
  if (kind === "rating") {
    return num.toFixed(options?.digits ?? 1);
  }
  if (kind === "percent") {
    return `${(num * (num <= 1 ? 100 : 1)).toFixed(options?.digits ?? 0)}%`;
  }
  if (kind === "integer") {
    return Math.round(num).toLocaleString("en-US");
  }
  if (typeof value === "string" && Number.isNaN(num)) {
    return value;
  }
  return num.toLocaleString("en-US", {
    maximumFractionDigits: options?.digits ?? 2,
  });
}

/** Grid ranks (AGR / ATGR): always 2 decimal places, or em dash if missing. */
export function formatGridRank(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(2);
}
