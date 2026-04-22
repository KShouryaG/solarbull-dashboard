export default function MetricCard({ label, value, sub, accent, icon, trend, small }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      borderRadius: "var(--border-radius-lg)",
      padding: small ? "14px 16px" : "16px 18px",
      boxShadow: "0 1px 2px rgba(20,15,10,0.04)",
      border: "1px solid var(--color-border-light)",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500 }}>
          {label}
        </div>
        {icon && <span style={{ fontSize: 17, opacity: 0.55 }}>{icon}</span>}
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
  );
}
