export default function MetricCard({ label, value, sub, accent, icon, trend, small }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      borderRadius: "var(--border-radius-lg)",
      padding: small ? "14px 16px" : "18px 20px",
      boxShadow: "var(--shadow-sm)",
      border: "1px solid var(--color-border-light)",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: ".6px", fontWeight: 500 }}>
          {label}
        </div>
        {icon && <span style={{ fontSize: 18, opacity: 0.6 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: small ? 20 : 26, fontWeight: 600, color: accent || "var(--color-text-primary)", lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: trend === "up" ? "var(--color-text-success)" : trend === "down" ? "var(--color-text-danger)" : "var(--color-text-secondary)" }}>
          {trend === "up" ? "▲ " : trend === "down" ? "▼ " : ""}{sub}
        </div>
      )}
    </div>
  );
}
