import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, ZoomControl } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { usePlants } from "../context/PlantContext.jsx";
import { StatusBadge, GradeBadge } from "../components/Badge.jsx";
import { fmtDec, fmtPct, fmt } from "../utils/format.js";
import { GRADE_COLORS } from "../utils/computed.js";

const STATUS_COLORS = { online: "#0E9B65", warning: "#F7941D", offline: "#DC2626" };
const STATUS_FILL   = { online: "#22c55e", warning: "#F7941D", offline: "#ef4444" };

export default function MapView() {
  const navigate           = useNavigate();
  const { plants, loading, fetchPlants } = usePlants();
  const [filter, setFilter]   = useState("all");
  const [selected, setSelected] = useState(null);

  useEffect(() => { fetchPlants(); }, []);

  const mapped = useMemo(() =>
    plants.filter((p) => p.latitude && p.longitude &&
      parseFloat(p.latitude) !== 0 && parseFloat(p.longitude) !== 0),
    [plants]);

  const filtered = useMemo(() =>
    filter === "all" ? mapped : mapped.filter((p) => p.status === filter),
    [mapped, filter]);

  // Center on mean coordinate of plants
  const center = useMemo(() => {
    if (!mapped.length) return [20.5937, 78.9629]; // India center
    const lat = mapped.reduce((s, p) => s + parseFloat(p.latitude), 0) / mapped.length;
    const lng = mapped.reduce((s, p) => s + parseFloat(p.longitude), 0) / mapped.length;
    return [lat, lng];
  }, [mapped]);

  const counts = useMemo(() => ({
    online:  plants.filter((p) => p.status === "online").length,
    warning: plants.filter((p) => p.status === "warning").length,
    offline: plants.filter((p) => p.status === "offline").length,
  }), [plants]);

  const totalPower = useMemo(() =>
    plants.reduce((s, p) => s + (p.currentPower ?? 0), 0), [plants]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  return (
    <div className="fade-in" style={{ height: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Fleet Map</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {mapped.length} of {plants.length} plants geo-located
          </div>
        </div>

        {/* Filter + stats chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[
            ["all",     `All (${plants.length})`,      "#6B7280"],
            ["online",  `Online (${counts.online})`,   "#0E9B65"],
            ["warning", `Warning (${counts.warning})`, "#F7941D"],
            ["offline", `Offline (${counts.offline})`, "#DC2626"],
          ].map(([val, label, color]) => (
            <button key={val} onClick={() => setFilter(val)} style={{
              padding: "6px 14px", fontSize: 12, fontWeight: filter === val ? 600 : 400,
              borderRadius: 999, border: `2px solid ${filter === val ? color : "var(--color-border-light)"}`,
              background: filter === val ? color + "15" : "transparent",
              color: filter === val ? color : "var(--color-text-secondary)",
            }}>
              {label}
            </button>
          ))}
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "0 8px", borderLeft: "1px solid var(--color-border-light)" }}>
            Live: <strong>{fmt(Math.round(totalPower))} kW</strong>
          </div>
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, borderRadius: 12, overflow: "hidden", border: "1px solid var(--color-border-light)", boxShadow: "var(--shadow-sm)", minHeight: 480 }}>
        <MapContainer
          center={center}
          zoom={6}
          style={{ width: "100%", height: "100%" }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="bottomright" />
          {filtered.map((p) => (
            <CircleMarker
              key={p.id}
              center={[parseFloat(p.latitude), parseFloat(p.longitude)]}
              radius={selected === p.id ? 14 : 10}
              pathOptions={{
                color: STATUS_COLORS[p.status] || "#6B7280",
                fillColor: STATUS_FILL[p.status] || "#9CA3AF",
                fillOpacity: 0.85,
                weight: selected === p.id ? 3 : 2,
              }}
              eventHandlers={{ click: () => setSelected(selected === p.id ? null : p.id) }}
            >
              <Popup>
                <div style={{ minWidth: 200, fontFamily: "inherit" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#111" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>{p.city}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12 }}>
                    <span style={{ color: "#888" }}>Status</span>
                    <span style={{ fontWeight: 600, color: STATUS_COLORS[p.status] }}>{p.status}</span>
                    <span style={{ color: "#888" }}>Capacity</span>
                    <span>{fmtDec(p.capacity)} kWp</span>
                    <span style={{ color: "#888" }}>Live Power</span>
                    <span>{p.currentPower != null ? `${fmtDec(p.currentPower)} kW` : "—"}</span>
                    <span style={{ color: "#888" }}>Today</span>
                    <span>{fmt(p.todayEnergy)} kWh</span>
                    <span style={{ color: "#888" }}>PR</span>
                    <span style={{ fontWeight: 600, color: GRADE_COLORS[p.grade] }}>
                      {p.performanceRatio ? fmtPct(p.performanceRatio) : "—"}
                    </span>
                    <span style={{ color: "#888" }}>Grade</span>
                    <span style={{ fontWeight: 600, color: GRADE_COLORS[p.grade] }}>{p.grade}</span>
                  </div>
                  <button
                    onClick={() => navigate(`/plants/${p.id}`)}
                    style={{ marginTop: 10, width: "100%", padding: "7px 0", background: "#1E5BA6", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    View Details →
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 20, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        {Object.entries(STATUS_FILL).map(([s, c]) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
            <span style={{ color: "var(--color-text-secondary)", textTransform: "capitalize" }}>{s}</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>
          Click a marker for details
        </div>
      </div>
    </div>
  );
}
