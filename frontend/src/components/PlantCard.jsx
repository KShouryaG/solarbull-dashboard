import { useNavigate } from "react-router-dom";
import { StatusBadge, GradeBadge } from "./Badge.jsx";
import { fmtDec, fmt, fmtPct } from "../utils/format.js";

export default function PlantCard({ plant }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/plants/${plant.id}`)}
      className="fade-in"
      style={{
        background: "var(--color-background-primary)",
        border: "1px solid var(--color-border-light)",
        borderRadius: "var(--border-radius-lg)",
        padding: "16px",
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
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{plant.name}</div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {plant.devices?.[0]?.model || "Sungrow"} · {fmtDec(plant.capacity)} kWp
          </div>
        </div>
        <StatusBadge status={plant.status} />
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { k: "Power",  v: plant.currentPower !== null && plant.currentPower !== undefined ? `${fmtDec(plant.currentPower)} kW` : "—" },
          { k: "Today",  v: `${fmt(plant.todayEnergy)} kWh` },
          { k: "PR",     v: plant.performanceRatio !== null && plant.performanceRatio !== undefined ? fmtPct(plant.performanceRatio) : "—" },
        ].map(({ k, v }) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-border-light)" }}>
        <GradeBadge grade={plant.grade} />
        {(plant.errors?.length || 0) > 0 && (
          <span style={{ fontSize: 11, color: "var(--color-text-danger)", fontWeight: 500 }}>
            ⚠ {plant.errors.length} alert{plant.errors.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
