import { SeverityBadge } from "./Badge.jsx";
import { formatDate } from "../utils/format.js";

export default function AlertsTable({ alarms, showPlant = false, onPlantClick }) {
  if (!alarms?.length) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--color-text-success)", background: "var(--color-background-success)", borderRadius: "var(--border-radius-lg)", fontSize: 13 }}>
        ✓ No active alerts
      </div>
    );
  }

  const cols = showPlant
    ? ["Plant", "Code", "Description", "Severity", "Device SN", "Time", "Fix"]
    : ["Code", "Description", "Severity", "Device SN", "Time", "Recommended fix"];

  return (
    <div style={{ overflowX: "auto", borderRadius: "var(--border-radius-lg)", border: "1px solid var(--color-border-light)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--color-background-secondary)" }}>
            {cols.map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {alarms.map((e, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--color-border-light)" }}
              onMouseOver={(ev) => ev.currentTarget.style.background = "var(--color-background-secondary)"}
              onMouseOut={(ev)  => ev.currentTarget.style.background = ""}>
              {showPlant && (
                <td style={{ padding: "10px 14px", fontWeight: 500 }}>
                  <span
                    style={{ color: "var(--sb-blue)", cursor: "pointer" }}
                    onClick={() => onPlantClick?.(e.plantId)}>
                    {e.plantName}
                  </span>
                </td>
              )}
              <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "monospace", fontSize: 12 }}>{e.code}</td>
              <td style={{ padding: "10px 14px" }}>{e.desc}</td>
              <td style={{ padding: "10px 14px" }}><SeverityBadge severity={e.severity} /></td>
              <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--color-text-secondary)" }}>{e.deviceSn || "—"}</td>
              <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontSize: 12, color: "var(--color-text-secondary)" }}>
                {e.timestamp ? formatDate(e.timestamp, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
              <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--color-text-secondary)", maxWidth: 220 }}>{e.fix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
