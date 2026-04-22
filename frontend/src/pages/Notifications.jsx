import { useState, useEffect, useMemo } from "react";
import { getNotifications } from "../api.js";
import { SeverityBadge, StatusBadge } from "../components/Badge.jsx";
import { formatDate } from "../utils/format.js";
import { useNavigate } from "react-router-dom";

export default function Notifications() {
  const navigate = useNavigate();
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState("all");
  const [search,    setSearch]    = useState("");
  const [sortBy,    setSortBy]    = useState("severity");

  const load = async (force = false) => {
    if (force) setLoading(true);
    try {
      const d = await getNotifications();
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const notifications = data?.notifications || [];
  const counts        = data?.counts || { total: 0, high: 0, medium: 0, low: 0, plants_affected: 0 };

  const filtered = useMemo(() => {
    let f = notifications;
    if (filter !== "all")  f = f.filter((n) => n.severity === filter);
    if (search) {
      const s = search.toLowerCase();
      f = f.filter((n) =>
        n.plantName?.toLowerCase().includes(s) ||
        n.desc?.toLowerCase().includes(s) ||
        n.code?.toLowerCase().includes(s)
      );
    }
    if (sortBy === "time") f = [...f].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    return f;
  }, [notifications, filter, search, sortBy]);

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Notification Center</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            All active alarms and faults across your fleet
          </div>
        </div>
        <button onClick={() => load(true)} disabled={loading} style={{ background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 600, padding: "8px 16px" }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Alerts",       value: counts.total,            accent: counts.total > 0 ? "#DC2626" : "#0E9B65" },
          { label: "Critical (High)",    value: counts.high,             accent: counts.high > 0 ? "#DC2626" : "#6B7280" },
          { label: "Medium",             value: counts.medium,           accent: counts.medium > 0 ? "#F7941D" : "#6B7280" },
          { label: "Low Priority",       value: counts.low,              accent: "#6B7280" },
          { label: "Plants Affected",    value: counts.plants_affected,  accent: counts.plants_affected > 0 ? "#1E5BA6" : "#0E9B65" },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: "16px 20px", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: ".6px", fontWeight: 500, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: accent }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plant, code, description…"
          style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 4, background: "var(--color-background-secondary)", padding: 4, borderRadius: 8 }}>
          {[["all","All"],["high","Critical"],["medium","Medium"],["low","Low"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{
              padding: "5px 12px", fontSize: 12, fontWeight: filter === v ? 600 : 400,
              background: filter === v ? "var(--color-background-primary)" : "transparent",
              color: filter === v ? "var(--sb-blue)" : "var(--color-text-secondary)",
              border: filter === v ? "1px solid var(--color-border-light)" : "none",
              borderRadius: 6,
            }}>{l}</button>
          ))}
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "auto", fontSize: 12 }}>
          <option value="severity">Sort: Severity</option>
          <option value="time">Sort: Newest first</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
          {filtered.length} of {notifications.length} alerts
        </span>
      </div>

      {/* Alert list */}
      {loading && !data ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--color-text-tertiary)" }}>
          <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          Loading alerts…
        </div>
      ) : !filtered.length ? (
        <div style={{ padding: 60, textAlign: "center", background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "1px solid var(--color-border-light)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#0E9B65" }}>
            {notifications.length === 0 ? "No active alerts" : "No alerts match your filter"}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
            {notifications.length === 0 ? "All plants are operating normally" : "Try adjusting the search or filter"}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((n, i) => (
            <div key={i} style={{
              background: "var(--color-background-primary)",
              borderRadius: "var(--border-radius-lg)",
              padding: "14px 18px",
              boxShadow: "var(--shadow-sm)",
              border: "1px solid var(--color-border-light)",
              borderLeft: `4px solid ${n.severity === "high" ? "#DC2626" : n.severity === "medium" ? "#F7941D" : "#6B7280"}`,
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto",
              gap: 16,
              alignItems: "center",
            }}>
              {/* Severity */}
              <SeverityBadge severity={n.severity} />

              {/* Content */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color: "var(--color-text-primary)", background: "var(--color-background-secondary)", padding: "2px 6px", borderRadius: 4 }}>{n.code}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{n.desc}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 2 }}>
                  <span style={{ color: "var(--sb-blue)", fontWeight: 500, cursor: "pointer" }} onClick={() => navigate(`/plants/${n.plantId}`)}>
                    {n.plantName}
                  </span>
                  {n.deviceSn && <span> · Device: {n.deviceSn}</span>}
                  {n.timestamp && <span> · {formatDate(n.timestamp, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
                {n.fix && (
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
                    💡 {n.fix}
                  </div>
                )}
              </div>

              {/* Plant status */}
              {n.plantStatus && <StatusBadge status={n.plantStatus} />}

              {/* Action */}
              <button
                onClick={() => navigate(`/plants/${n.plantId}`)}
                style={{ padding: "6px 14px", fontSize: 12, background: "transparent", border: "1px solid var(--color-border-light)", borderRadius: 6, color: "var(--sb-blue)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                View Plant →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
