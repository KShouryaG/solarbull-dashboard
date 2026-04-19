import { GRADE_COLORS, GRADE_BG } from "../utils/computed.js";

const STATUS_COLOR = { online: "#0E9B65", warning: "#B45309", offline: "#DC2626" };
const STATUS_BG    = { online: "#E8F8F1", warning: "#FFF8E8", offline: "#FEF0F0" };

export function StatusBadge({ status }) {
  const s = status || "offline";
  return (
    <span style={{
      fontSize: 11, padding: "3px 10px", borderRadius: 999,
      fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase",
      color: STATUS_COLOR[s] || STATUS_COLOR.offline,
      background: STATUS_BG[s] || STATUS_BG.offline,
    }}>
      {s}
    </span>
  );
}

export function GradeBadge({ grade }) {
  const g = grade || "N/A";
  return (
    <span style={{
      fontSize: 11, padding: "3px 10px", borderRadius: 999,
      fontWeight: 600, letterSpacing: 0.3,
      color: GRADE_COLORS[g],
      background: GRADE_BG[g],
    }}>
      {g}
    </span>
  );
}

export function SeverityBadge({ severity }) {
  const map = {
    high:   { bg: "#FEF0F0", color: "#DC2626" },
    medium: { bg: "#FFF8E8", color: "#B45309" },
    low:    { bg: "#E8F8F1", color: "#0E9B65" },
  };
  const s = map[severity] || map.medium;
  return (
    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, fontWeight: 600, color: s.color, background: s.bg }}>
      {severity}
    </span>
  );
}
