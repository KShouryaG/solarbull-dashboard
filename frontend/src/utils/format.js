export const fmt = (n) => {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + " M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + " K";
  return Number(n).toLocaleString("en-IN");
};

export const fmtDec = (n, d = 1) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPct  = (n, d = 1) => (n === null || n === undefined) ? "—" : fmtDec(n * 100, d) + "%";
export const fmtKW   = (n)        => (n === null || n === undefined) ? "—" : fmtDec(n) + " kW";
export const fmtKWh  = (n)        => (n === null || n === undefined) ? "—" : fmt(n) + " kWh";
export const fmtKWp  = (n)        => (n === null || n === undefined) ? "—" : fmtDec(n) + " kWp";
export const rupee   = (n)        => (n === null || n === undefined) ? "—" : "₹" + fmt(n);

export const formatDate = (iso, opts) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-IN", opts || { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(iso); }
};

export const shortDate = (iso) => formatDate(iso, { day: "2-digit", month: "short" });
