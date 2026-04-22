import { useNavigate } from "react-router-dom";
import { StatusBadge, GradeBadge } from "./Badge.jsx";
import { fmtDec, fmt, fmtPct } from "../utils/format.js";

export default function PlantCard({ plant }) {
  const navigate = useNavigate();
  const utilPct = plant.capacity && plant.currentPower != null
    ? Math.min(100, Math.round((plant.currentPower / plant.capacity) * 100))
    : null;

  return (
    <div
      onClick={() => navigate(`/plants/${plant.id}`)}
      className="fade-in"
      style={{
        background: "var(--color-background-primary)",
        border: "1px solid var(--color-border-light)",
        borderRadius: "var(--border-radius-lg)",
        padding: "14px 16px",
        cursor: "pointer",
        transition: "box-shadow 0.15s, border-color 0.15s",
        boxShadow: "var(--shadow-sm)",
      }}
      onMouseOver={(e) => { e.currentTarget.style.boxShadow = "var(--shadow-md)"; e.currentTarget.style.borderColor = "var(--sb-blue)"; }}
      onMouseOut={(e)  => { e.currentTarget.style.boxShadow = "var(--shadow-sm)"; e.currentTarget.style.borderColor = "var(--color-border-light)"; }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {plant.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {plant.city && <>{plant.city} · </>}{fmtDec(plant.capacity)} kWp
          </div>
        </div>
        <StatusBadge status={plant.status} />
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        {[
          { k: "Right now", v: plant.currentPower != null ? `${fmtDec(plant.currentPower)} kW` : "—" },
          { k: "Today",     v: `${fmt(plant.todayEnergy)} kWh` },
          { k: "Health",    v: plant.performanceRatio != null ? fmtPct(plant.performanceRatio) : "—" },
        ].map(({ k, v }) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", letterSpacing: 0.3, fontWeight: 500 }}>{k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Progress bar — generating % of max */}
      {utilPct !== null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--color-text-secondary)", marginBottom: 4 }}>
            <span>Generating at</span>
            <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{utilPct}% of max</span>
          </div>
          <div style={{ height: 5, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${utilPct}%`, height: "100%", borderRadius: 3,
              background: plant.status === "offline" ? "#DC2626" : "var(--sb-orange)",
              transition: "width 0.4s ease",
            }} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--color-border-light)" }}>
        <GradeBadge grade={plant.grade} />
        {(plant.errors?.length || 0) > 0 ? (
          <span style={{ fontSize: 11, color: "var(--color-text-danger)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
            ⚠ {plant.errors.length} issue{plant.errors.length > 1 ? "s" : ""}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "#0E9B65", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
            ✓ All good
          </span>
        )}
      </div>
    </div>
  );
}
