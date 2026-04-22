// SOLARBULL-IMPROVEMENT: Task 12 — actionable fault panel with fix steps
import { useState } from "react";
import { SeverityBadge } from "./Badge.jsx";
import { formatDate } from "../utils/format.js";

const SEV_ACCENT = { high: "#DC2626", medium: "#F7941D", low: "#6B7280" };
const SEV_BG     = { high: "#FEF0F0", medium: "#FFF8EE", low: "#F9FAFB" };

function FaultCard({ e, showPlant, onPlantClick }) {
  const [open, setOpen] = useState(false);
  const accent = SEV_ACCENT[e.severity] || "#6B7280";
  const bg     = SEV_BG[e.severity]     || "#F9FAFB";

  return (
    <div style={{
      borderLeft: `4px solid ${accent}`,
      background: "var(--color-background-primary)",
      borderRadius: "0 var(--border-radius-lg) var(--border-radius-lg) 0",
      border: `1px solid var(--color-border-light)`,
      borderLeftColor: accent,
      marginBottom: 10,
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer" }}
      >
        <code style={{ fontSize: 12, fontWeight: 700, background: bg, color: accent, padding: "2px 7px", borderRadius: 4, flexShrink: 0 }}>
          {e.code}
        </code>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {e.desc}
            {showPlant && e.plantName && (
              <span
                style={{ marginLeft: 8, fontSize: 11, color: "var(--sb-blue)", cursor: "pointer", fontWeight: 400 }}
                onClick={(ev) => { ev.stopPropagation(); onPlantClick?.(e.plantId); }}
              >
                — {e.plantName}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
            {e.timestamp ? formatDate(e.timestamp, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
            {e.deviceSn ? ` · SN: ${e.deviceSn}` : ""}
          </div>
        </div>
        <SeverityBadge severity={e.severity} />
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Expanded fix steps */}
      {open && (
        <div style={{ padding: "0 16px 14px 16px", borderTop: `1px solid ${accent}20` }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: accent, marginBottom: 8, marginTop: 10 }}>
            Recommended Action
          </div>
          <div style={{ background: bg, borderRadius: 8, padding: "10px 14px", fontSize: 13, lineHeight: 1.6, color: "var(--color-text-primary)", borderLeft: `3px solid ${accent}` }}>
            {e.fix || "Contact service center."}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlertsTable({ alarms, showPlant = false, onPlantClick }) {
  if (!alarms?.length) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--color-text-success)", background: "var(--color-background-success)", borderRadius: "var(--border-radius-lg)", fontSize: 13 }}>
        ✓ No active alerts
      </div>
    );
  }

  const high   = alarms.filter((a) => a.severity === "high");
  const medium = alarms.filter((a) => a.severity === "medium");
  const low    = alarms.filter((a) => !["high", "medium"].includes(a.severity));

  const group = (label, items, accent) => items.length === 0 ? null : (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: accent, marginBottom: 8 }}>
        {label} ({items.length})
      </div>
      {items.map((e, i) => <FaultCard key={i} e={e} showPlant={showPlant} onPlantClick={onPlantClick} />)}
    </div>
  );

  return (
    <div>
      {group("Critical", high,   "#DC2626")}
      {group("Warning",  medium, "#F7941D")}
      {group("Info",     low,    "#6B7280")}
    </div>
  );
}
