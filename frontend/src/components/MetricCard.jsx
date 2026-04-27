function Sparkline({ values, color = "#F7941D", w = 80, h = 36 }) {
  if (!values || values.length < 2) return null;
  const mn = Math.min(...values), mx = Math.max(...values);
  const range = mx - mn || 1;
  const xs = values.map((_, i) => (i / (values.length - 1)) * w);
  const ys = values.map((v) => h - 2 - ((v - mn) / range) * (h - 4));
  const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fill = `${line} L${w},${h} L0,${h} Z`;
  const gid = `sk${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={w} height={h} style={{ flexShrink: 0, overflow: "visible", opacity: 0.9 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MetricCard({ label, value, sub, accent, icon, trend, small, sparkline, sparklineColor }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      borderRadius: "var(--border-radius-lg)",
      padding: small ? "14px 16px" : "16px 18px",
      boxShadow: "0 1px 2px rgba(20,15,10,0.04)",
      border: "1px solid var(--color-border-light)",
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500 }}>
            {label}
          </div>
          {icon && <span style={{ fontSize: 15, opacity: 0.45 }}>{icon}</span>}
        </div>
        <div style={{
          fontSize: small ? 20 : 26, fontWeight: 650,
          color: accent || "var(--color-text-primary)",
          letterSpacing: -0.3, fontVariantNumeric: "tabular-nums", lineHeight: 1.15,
        }}>
          {value}
        </div>
        {sub && (
          <div style={{
            fontSize: 11.5,
            color: trend === "up" ? "var(--color-text-success)" : trend === "down" ? "var(--color-text-danger)" : "var(--color-text-secondary)",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {trend === "up" && <span>▲</span>}
            {trend === "down" && <span>▼</span>}
            {sub}
          </div>
        )}
      </div>
      {sparkline && (
        <div style={{ display: "flex", alignItems: "center", paddingTop: 4 }}>
          <Sparkline values={sparkline} color={sparklineColor || accent || "#F7941D"} />
        </div>
      )}
    </div>
  );
}
