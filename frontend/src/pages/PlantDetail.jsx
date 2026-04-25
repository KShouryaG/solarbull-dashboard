import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getInverters, getPeriodCompare, getPowerCurve, getPlantKPIs, getMonthlyChart, getPlantHistory } from "../api.js";
import { usePlants } from "../context/PlantContext.jsx";
import MetricCard from "../components/MetricCard.jsx";
import { StatusBadge, GradeBadge, SeverityBadge } from "../components/Badge.jsx";
import AlertsTable from "../components/AlertsTable.jsx";
import { fmt, fmtDec, fmtPct, fmtKW, rupee, formatDate } from "../utils/format.js";
import { BENCHMARKS, plantAge, degradedCapacity, GRADE_COLORS } from "../utils/computed.js";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";

const TABS = [
  ["overview",   "Overview"],
  ["inverters",  "Inverters"],
  ["charts",     "Charts"],
  ["periods",    "Period Compare"],
  ["financial",  "Financial & Env"],
  ["alerts",     "Alerts"],
];

const V = (val, unit = "", dec = 1) =>
  val != null && val !== 0 ? `${fmtDec(val, dec)} ${unit}`.trim() : "—";

const Param = ({ label, value, accent, wide }) => (
  <div style={{ padding: "6px 0", borderBottom: "1px solid var(--color-border-light)", gridColumn: wide ? "span 2" : undefined }}>
    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: accent || "var(--color-text-primary)" }}>{value}</div>
  </div>
);

const SectionTitle = ({ children, color = "var(--sb-orange)" }) => (
  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color, marginBottom: 8, marginTop: 14, borderBottom: `1px solid ${color}30`, paddingBottom: 4 }}>
    {children}
  </div>
);

// Tiny delta badge
const Delta = ({ pct }) => {
  if (pct == null) return <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>—</span>;
  const up = pct >= 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? "#0E9B65" : "#DC2626", background: up ? "#E8F8F1" : "#FEF0F0", padding: "2px 6px", borderRadius: 4 }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
};

export default function PlantDetail() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const { plants, loading: plantsLoading, fetchPlants } = usePlants();
  const [inverters,  setInverters]  = useState([]);
  const [invLoading, setInvLoading] = useState(true);
  const [kpis,       setKpis]       = useState(null);
  const [tab,        setTab]        = useState("overview");
  const [selInv,     setSelInv]     = useState(null); // selected inverter for modal

  useEffect(() => { fetchPlants(); }, []);

  useEffect(() => {
    setInvLoading(true);
    getInverters(id)
      .then((d) => setInverters(d.inverters || []))
      .catch(() => setInverters([]))
      .finally(() => setInvLoading(false));
    getPlantKPIs(id).then(setKpis).catch(() => {});
  }, [id]);

  const plant   = plants.find((p) => String(p.id) === String(id)) || null;
  const loading = plantsLoading && !plant;

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  if (!plant) return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-secondary)" }}>
      Plant not found. <span style={{ color: "var(--sb-blue)", cursor: "pointer" }} onClick={() => navigate("/")}>← Back</span>
    </div>
  );

  const age      = plantAge(plant.installDate);
  const degraded = age ? degradedCapacity(plant.capacity, age) : null;
  const co2Total = plant.co2Avoided || plant.co2 || 0;
  const trees    = Math.round(co2Total / 21);
  const coal     = Math.round(co2Total / 2.42 / 1000 * 10) / 10;
  const homes    = Math.round((plant.totalEnergy || 0) / 1200);
  const rev30    = Math.round((plant.todayEnergy || 0) * 26 * (plant.tariffPerKwh || 4.5));
  const rev365   = Math.round((plant.todayEnergy || 0) * 300 * (plant.tariffPerKwh || 4.5));
  const payback  = plant.capacity ? Math.round(plant.capacity * 45000 / Math.max(rev365, 1) * 10) / 10 : null;

  const totalLiveKW  = inverters.reduce((s, inv) => s + (inv.activePower || 0), 0);
  const totalDCKW    = inverters.reduce((s, inv) => s + (inv.totalDCPower || 0), 0);
  const fleetEff     = totalDCKW > 0 ? Math.round((totalLiveKW / totalDCKW) * 1000) / 10 : null;
  const invApiLevel  = inverters.length > 0 ? (inverters[0].apiLevel || 1) : 1;

  const radarData = [
    { metric: "PR",    value: plant.performanceRatio ? Math.min(100, plant.performanceRatio * 100) : 0 },
    { metric: "CF%",   value: plant.capacityFactor ? Math.min(100, plant.capacityFactor) : 0 },
    { metric: "Avail", value: plant.status === "online" ? 98 : plant.status === "warning" ? 80 : 30 },
    { metric: "Yield", value: plant.specificYield ? Math.min(100, (plant.specificYield / 7) * 100) : 0 },
  ];

  const historyData = (plant.history || []).map((h) => ({ date: h.date?.slice(5), energy: h.energy || 0 }));

  const row = (label, value, hint) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--color-border-light)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, textAlign: "right", maxWidth: 220 }}>{value}</div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* Breadcrumb — SOLARBULL-IMPROVEMENT: Task 9 "Plants" → removed, kept as Fleet */}
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16 }}>
        <span style={{ cursor: "pointer", color: "var(--sb-blue)" }} onClick={() => navigate("/")}>Fleet Overview</span>
        <span style={{ margin: "0 6px" }}>›</span>
        <span>{plant.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{plant.name}</h1>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
            {plant.devices?.[0]?.model || "Sungrow"} · {plant.city}
            {plant.latitude && plant.longitude && ` · ${Number(plant.latitude).toFixed(3)}°N, ${Number(plant.longitude).toFixed(3)}°E`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <GradeBadge grade={plant.grade} />
          <StatusBadge status={plant.status} />
          <button onClick={() => navigate(`/compare?ids=${plant.id}`)} style={{ fontSize: 12, padding: "6px 14px", background: "transparent", border: "1px solid var(--color-border-light)", borderRadius: 6, color: "var(--sb-blue)" }}>
            ⚖ Compare
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        <MetricCard label="Capacity"       value={`${fmtDec(plant.capacity)} kWp`} icon="⚡" />
        <MetricCard label="Live Power"     value={plant.currentPower != null ? fmtKW(plant.currentPower) : "—"} accent="var(--sb-orange)" icon="☀"
          sub={kpis?.lastUpdated ? <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{formatDate(kpis.lastUpdated, { hour: "2-digit", minute: "2-digit" })}</span> : null} />
        <MetricCard label="Today"          value={`${fmt(plant.todayEnergy)} kWh`} icon="📈"
          sub={kpis?.todayDelta != null ? <Delta pct={kpis.todayDelta} /> : null} />
        <MetricCard label="This Month"     value={plant.monthEnergy != null ? `${fmt(plant.monthEnergy)} kWh` : "—"} icon="📅" />
        <MetricCard label="Lifetime"       value={`${fmt(Math.round((plant.totalEnergy||0)/1000))} MWh`} icon="🏆" />
        <MetricCard label="Equiv. Hours"   value={kpis?.equivalentHours != null ? `${fmtDec(kpis.equivalentHours)} h` : (plant.specificYield != null ? `${fmtDec(plant.specificYield)} h` : "—")} icon="⏱"
          sub={<span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>kWh/kWp today</span>} />
        <MetricCard label="Perf. Ratio"    value={plant.performanceRatio != null ? fmtPct(plant.performanceRatio) : "—"}
          accent={plant.performanceRatio ? GRADE_COLORS[plant.grade] : undefined} icon="📊"
          sub={<span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>estimated</span>} />
        {/* SOLARBULL-IMPROVEMENT: Task 10 — "Est. revenue today" with tooltip */}
        <MetricCard
          label={
            <span title="Estimated based on your configured tariff rate (₹/kWh). Not actual billed revenue.">
              {kpis?.todayIncomeActual != null ? "Revenue Today" : "Est. revenue today"}{" "}
              <span title="Estimated based on your configured tariff rate (₹/kWh). Not actual billed revenue." style={{ cursor: "help", color: "var(--color-text-tertiary)", fontSize: 11 }}>ⓘ</span>
            </span>
          }
          value={kpis?.todayIncomeActual != null ? rupee(Math.round(kpis.todayIncomeActual)) : rupee(Math.round(plant.revenueToday || 0))}
          icon="₹"
          sub={kpis?.todayIncomeActual != null ? <span style={{ fontSize: 10, color: "#0E9B65" }}>from iSolarCloud</span> : null} />
        <MetricCard label="CO₂ Avoided"   value={`${fmt(Math.round(co2Total/1000))} t`} icon="🌿"
          sub={kpis?.co2Today != null ? `${Math.round(kpis.co2Today)} kg today` : `${fmt(trees)} trees`} />
        <MetricCard label="Active Alerts"  value={String(plant.errors?.length || plant.alarmCount || 0)} accent={(plant.errors?.length || plant.alarmCount || 0) > 0 ? "#DC2626" : undefined} icon="⚠" />
      </div>

      {/* Energy flow banner */}
      <EnergyFlowBanner plant={plant} inverters={inverters} totalLiveKW={totalLiveKW} totalDCKW={totalDCKW} fleetEff={fleetEff} />

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--color-border-light)", marginBottom: 20, flexWrap: "wrap", marginTop: 20 }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: "10px 18px", fontSize: 13, fontWeight: tab === k ? 600 : 400,
            color: tab === k ? "var(--sb-blue)" : "var(--color-text-secondary)",
            borderBottom: tab === k ? "2px solid var(--sb-blue)" : "2px solid transparent",
            background: "none", border: "none", borderRadius: 0, marginBottom: -2,
          }}>{l}</button>
        ))}
      </div>

      {/* ─── OVERVIEW ───────────────────────────────── */}
      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <SectionTitle>Performance & Generation</SectionTitle>
            {row("Capacity (STC)",     `${fmtDec(plant.capacity)} kWp`, "Rated at Standard Test Conditions")}
            {row("Live Power",         plant.currentPower != null ? fmtKW(plant.currentPower) : "—", "Real-time AC output")}
            {row("Today's Energy",     `${fmt(plant.todayEnergy)} kWh`, "Since midnight")}
            {kpis && row("Yesterday",  `${fmt(kpis.yesterday)} kWh`, <Delta pct={kpis.todayDelta} />)}
            {row("This Month",         plant.monthEnergy != null ? `${fmt(plant.monthEnergy)} kWh` : "—")}
            {kpis && row("Last Month", `${fmt(kpis.lastMonth)} kWh`, <Delta pct={kpis.monthDelta} />)}
            {row("Lifetime Energy",    `${fmt(Math.round((plant.totalEnergy||0)/1000))} MWh`)}
            {row("Specific Yield",     plant.specificYield ? `${fmtDec(plant.specificYield)} kWh/kWp/day` : "—")}
            {row("Performance Ratio",  plant.performanceRatio ? `${fmtPct(plant.performanceRatio)} (estimated)` : "—",
              "Estimated from peak sun hours — no irradiance sensor")}
            {row("Capacity Factor",    plant.capacityFactor ? `${fmtDec(plant.capacityFactor)}%` : "—")}
            {row("Grade",              <GradeBadge grade={plant.grade} />)}

            <SectionTitle>Technical Parameters</SectionTitle>
            {row("Peak Sun Hours",     `${fmtDec(plant.peakSunHours || 5.5)} h/day`, "India irradiance reference")}
            {row("Panel Efficiency",   "22–24%",    "Mono-PERC / TOPCon (STC)")}
            {row("Inverter Efficiency",`${fleetEff ? fleetEff + "%" : "97–99%"}`, "DC→AC live reading")}
            {row("Temp. Coefficient",  "−0.35%/°C", "Power derating above 25°C")}
            {row("Annual Degradation", "~0.5%/yr",  "Industry standard c-Si modules")}
            {age ? row("Plant Age",    `${age} years`, `Installed ${formatDate(plant.installDate)}`) : null}
            {degraded ? row("Est. Current Capacity", `${fmtDec(degraded)} kWp`, `After ${age}y degradation`) : null}
          </div>
          <div>
            <SectionTitle color="var(--sb-blue)">Reliability</SectionTitle>
            {row("Status",          <StatusBadge status={plant.status} />)}
            {row("Technical Avail.", plant.status === "online" ? "~98%+" : plant.status === "warning" ? "~80–95%" : "0%")}
            {row("Active Alerts",   plant.errors?.length || 0)}
            {row("Inverters Online", `${inverters.filter(i => i.status === "online").length} / ${inverters.length || plant.devices?.length || "—"}`)}

            <SectionTitle color="var(--sb-blue)">Device Information</SectionTitle>
            {(inverters.length ? inverters : plant.devices || []).slice(0, 3).map((d, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                {row(`Inv ${i + 1} Model`, d.model || "—")}
                {row(`Inv ${i + 1} SN`,   d.sn || d.deviceSn || "—")}
                {d.datalogSn && row("Datalogger SN", d.datalogSn)}
                {row("Status", <StatusBadge status={d.status} />)}
              </div>
            ))}
            {!inverters.length && !plant.devices?.length && row("Device", "No device data")}

            <SectionTitle color="var(--sb-blue)">Location</SectionTitle>
            {row("City / State",  plant.city || "—")}
            {row("Country",       plant.country || "IN")}
            {row("Coordinates",   plant.latitude && plant.longitude ? `${Number(plant.latitude).toFixed(4)}°N, ${Number(plant.longitude).toFixed(4)}°E` : "—")}

            {/* Mini radar */}
            <div style={{ marginTop: 16 }}>
              <SectionTitle>Performance Profile</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={70}>
                  <PolarGrid stroke="var(--color-border-light)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                  <Radar name="Plant" dataKey="value" stroke="var(--sb-orange)" fill="var(--sb-orange)" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ─── INVERTERS ──────────────────────────────── */}
      {tab === "inverters" && (
        <InvertersTab inverters={inverters} loading={invLoading} onSelect={setSelInv} apiLevel={invApiLevel} />
      )}

      {/* ─── CHARTS ─────────────────────────────────── */}
      {tab === "charts" && (
        <ChartsTab plant={plant} historyData={historyData} />
      )}

      {/* ─── PERIOD COMPARE ─────────────────────────── */}
      {tab === "periods" && <PeriodCompareTab plantId={plant.id} plantName={plant.name} />}

      {/* ─── FINANCIAL & ENV ────────────────────────── */}
      {tab === "financial" && (
        <FinancialTab plant={plant} kpis={kpis} co2Total={co2Total} trees={trees} coal={coal} homes={homes}
          rev30={rev30} rev365={rev365} payback={payback} fleetEff={fleetEff} />
      )}

      {/* ─── ALERTS ─────────────────────────────────── */}
      {tab === "alerts" && <AlertsTable alarms={plant.errors || []} />}

      {/* Inverter detail modal */}
      {selInv && <InverterModal inv={selInv} onClose={() => setSelInv(null)} />}
    </div>
  );
}

// ─── Energy Flow Banner ─────────────────────────────────────────────────────
function EnergyFlowBanner({ plant, inverters, totalLiveKW, totalDCKW, fleetEff }) {
  const box = (label, value, color = "#1E5BA6", sub) => (
    <div style={{ textAlign: "center", minWidth: 110 }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const arrow = (label) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "0 8px" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 20, color: "#9CA3AF" }}>→</div>
    </div>
  );
  const pvKW  = totalDCKW || plant.currentPower;
  const acKW  = totalLiveKW || plant.currentPower;
  const eff   = fleetEff ? `${fleetEff}%` : (pvKW && acKW ? `${Math.round(acKW/pvKW*100)}%` : "97–99%");

  return (
    <div style={{ background: "var(--color-background-primary)", border: "1px solid var(--color-border-light)", borderRadius: "var(--border-radius-lg)", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexWrap: "wrap", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ background: "#FFF8EE", border: "1.5px solid #F7941D", borderRadius: 10, padding: "10px 16px" }}>
        {box("PV Panels", pvKW != null ? `${fmtDec(pvKW)} kW` : "—", "#F7941D", "DC input")}
      </div>
      {arrow(`${eff} eff`)}
      <div style={{ background: "#EBF2FC", border: "1.5px solid #1E5BA6", borderRadius: 10, padding: "10px 16px" }}>
        {box("Inverter(s)", inverters.length ? `${inverters.length} unit${inverters.length > 1 ? "s" : ""}` : "—", "#1E5BA6", plant.devices?.[0]?.model || "Sungrow")}
      </div>
      {arrow("")}
      <div style={{ background: "#E8F8F1", border: "1.5px solid #0E9B65", borderRadius: 10, padding: "10px 16px" }}>
        {box("Grid Output", acKW != null ? `${fmtDec(acKW)} kW` : "—", "#0E9B65", "AC export")}
      </div>
      <div style={{ marginLeft: "auto", textAlign: "right", paddingLeft: 16, borderLeft: "1px solid var(--color-border-light)" }}>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>Today</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#F7941D" }}>{fmt(plant.todayEnergy)} kWh</div>
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{rupee(Math.round((plant.revenueToday||0)))} earned</div>
      </div>
    </div>
  );
}

// ─── Inverters Tab ───────────────────────────────────────────────────────────
function InvertersTab({ inverters, loading, onSelect, apiLevel }) {
  if (loading) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
    </div>
  );
  if (!inverters.length) return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-tertiary)" }}>No inverter data available</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {apiLevel < 2 && (
        <div style={{ padding: "12px 16px", background: "#FFF8EE", border: "1px solid #F7941D40", borderRadius: 8, fontSize: 12, color: "#92400E", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ fontSize: 16 }}>ℹ</span>
          <div>
            <strong>Basic device info shown.</strong> Per-inverter real-time parameters (AC voltages, MPPT currents, 3-phase data) are not returned by the iSolarCloud API for this account type — this is a known limitation of the developer API, not a configuration issue.
          </div>
        </div>
      )}
      {inverters.map((inv, i) => <InverterCard key={i} inv={inv} idx={i} onSelect={onSelect} />)}
    </div>
  );
}

function InverterCard({ inv, idx, onSelect }) {
  const [expanded, setExpanded] = useState(true);
  const statusColor = inv.status === "online" ? "#0E9B65" : inv.status === "warning" ? "#F7941D" : "#DC2626";

  // Determine what data we actually have
  const has3Phase  = inv.voltageA || inv.voltageB;
  const hasMPPT    = inv.mppt?.length > 0;
  const hasStrings = inv.strings?.length > 0;
  const maxStrI    = hasStrings ? Math.max(...inv.strings.map(s => s.current || 0)) : 0;

  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", borderTop: `3px solid ${statusColor}`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Inverter {idx + 1}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {inv.model} · {inv.sn} · {inv.runningStatus || inv.status}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {inv.activePower != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>AC Power</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#F7941D" }}>{fmtDec(inv.activePower)} kW</div>
            </div>
          )}
          {inv.efficiency != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Efficiency</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtDec(inv.efficiency)}%</div>
            </div>
          )}
          {inv.todayEnergy != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>Today</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{fmt(inv.todayEnergy)} kWh</div>
            </div>
          )}
          <button onClick={(e) => { e.stopPropagation(); onSelect(inv); }}
            style={{ fontSize: 11, padding: "5px 12px", background: "transparent", border: "1px solid var(--color-border-light)", borderRadius: 6, color: "var(--sb-blue)", cursor: "pointer" }}>
            Details →
          </button>
          <span style={{ fontSize: 14, color: "var(--color-text-tertiary)" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 18px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>

            {/* AC Output */}
            <div>
              <SectionTitle color="#1E5BA6">⚡ AC Output</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                <Param label="Active Power"   value={V(inv.activePower, "kW")} accent="#F7941D" />
                <Param label="Reactive Power" value={V(inv.reactivePower, "kVAR")} />
                <Param label="Power Factor"   value={inv.powerFactor != null ? fmtDec(inv.powerFactor, 3) : "—"} />
                <Param label="Frequency"      value={V(inv.frequency, "Hz")} />
                {has3Phase ? (
                  <>
                    <Param label="Phase A Voltage" value={V(inv.voltageA, "V")} />
                    <Param label="Phase A Current" value={V(inv.currentA, "A")} />
                    <Param label="Phase B Voltage" value={V(inv.voltageB, "V")} />
                    <Param label="Phase B Current" value={V(inv.currentB, "A")} />
                    <Param label="Phase C Voltage" value={V(inv.voltageC, "V")} />
                    <Param label="Phase C Current" value={V(inv.currentC, "A")} />
                    {inv.voltageAB && <Param label="Line V (AB)" value={V(inv.voltageAB, "V")} />}
                    {inv.voltageBC && <Param label="Line V (BC)" value={V(inv.voltageBC, "V")} />}
                    {inv.voltageCA && <Param label="Line V (CA)" value={V(inv.voltageCA, "V")} />}
                  </>
                ) : (
                  <>
                    <Param label="AC Voltage" value={V(inv.voltage_ac, "V")} />
                    <Param label="AC Current" value={V(inv.current_ac, "A")} />
                  </>
                )}
              </div>
            </div>

            {/* DC Input + MPPT */}
            <div>
              <SectionTitle color="#F7941D">☀ DC Input / MPPT</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                <Param label="Total DC Power" value={V(inv.totalDCPower, "kW")} accent="#F7941D" />
                <Param label="Bus DC Voltage" value={V(inv.busDCVoltage, "V")} />
              </div>
              {hasMPPT && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--color-text-tertiary)", marginBottom: 8 }}>MPPT Inputs</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                    {inv.mppt.map((m) => (
                      <div key={m.idx} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "8px 10px", border: "1px solid var(--color-border-light)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#F7941D", marginBottom: 4 }}>MPPT {m.idx}</div>
                        <div style={{ fontSize: 12 }}>{V(m.voltage, "V")}</div>
                        <div style={{ fontSize: 12 }}>{V(m.current, "A")}</div>
                        {m.power != null && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{fmtDec(m.power)} kW</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!hasMPPT && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                  <Param label="DC Voltage (MPPT 1)" value={V(inv.voltage_dc, "V")} />
                  <Param label="DC Current (MPPT 1)" value={V(inv.current_dc, "A")} />
                </div>
              )}
            </div>

            {/* Thermal + Energy + Irradiance */}
            <div>
              <SectionTitle color="#0E9B65">🌡 Thermal & Energy</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                <Param label="Internal Temp" value={V(inv.tempInternal, "°C")}
                  accent={inv.tempInternal > 75 ? "#DC2626" : inv.tempInternal > 60 ? "#F7941D" : undefined} />
                <Param label="Heatsink Temp" value={V(inv.tempHeatsink, "°C")}
                  accent={inv.tempHeatsink > 85 ? "#DC2626" : inv.tempHeatsink > 70 ? "#F7941D" : undefined} />
                {inv.tempModule != null && <Param label="Module Temp"  value={V(inv.tempModule, "°C")} />}
                {inv.tempAmbient != null && <Param label="Ambient Temp" value={V(inv.tempAmbient, "°C")} />}
                {inv.irradiance != null && (
                  <Param label="Irradiance" value={V(inv.irradiance, "W/m²")} accent="#F7941D" wide />
                )}
                <Param label="Efficiency"   value={inv.efficiency != null ? `${fmtDec(inv.efficiency)}%` : "—"} />
                <Param label="Today Energy" value={inv.todayEnergy != null ? `${fmt(inv.todayEnergy)} kWh` : "—"} />
                <Param label="Lifetime"     value={inv.totalEnergy != null ? `${fmt(Math.round(inv.totalEnergy/1000))} MWh` : "—"} wide />
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-text-tertiary)", display: "flex", flexWrap: "wrap", gap: "3px 14px" }}>
                <span>Updated: {formatDate(inv.lastUpdate)}</span>
                {inv.commissioningDate && <span>Commissioned: {formatDate(inv.commissioningDate)}</span>}
                {inv.datalogSn && <span>Datalogger: {inv.datalogSn}</span>}
                {inv.faultMeaning && <span style={{ color: "#DC2626", fontWeight: 600 }}>⚠ {inv.faultMeaning}</span>}
                {inv.apiLevel === 1 && <span style={{ color: "#F7941D" }}>Basic data only</span>}
              </div>
            </div>
          </div>

          {/* String Health */}
          {hasStrings && (
            <div style={{ marginTop: 20 }}>
              <SectionTitle>🔌 String Current Health</SectionTitle>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
                Each bar = one string. Short bar or red = underperforming / fault.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {inv.strings.map((s) => {
                  const pct = maxStrI > 0 ? (s.current / maxStrI) * 100 : 0;
                  const alert = pct < 60 && s.current > 0;
                  const zero  = s.current === 0;
                  return (
                    <div key={s.idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 38 }}
                      title={`String ${s.idx} (MPPT${s.mpptIdx}): ${s.current}A${s.voltage ? ` / ${s.voltage}V` : ""}`}>
                      <div style={{ fontSize: 9, color: "var(--color-text-tertiary)", marginBottom: 2 }}>S{s.idx}</div>
                      <div style={{ width: 16, height: 70, background: "var(--color-background-secondary)", borderRadius: 4, position: "relative", border: "1px solid var(--color-border-light)", overflow: "hidden" }}>
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${pct}%`, background: zero ? "#E5E7EB" : alert ? "#DC2626" : "#0E9B65", borderRadius: "0 0 3px 3px", transition: "height 0.4s" }} />
                      </div>
                      <div style={{ fontSize: 9, marginTop: 2, color: zero ? "#9CA3AF" : alert ? "#DC2626" : "var(--color-text-secondary)" }}>
                        {s.current}A
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* String table */}
              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ background: "var(--color-background-secondary)" }}>
                      {["String", "MPPT", "Current (A)", "Voltage (V)", "Status"].map((h) => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--color-text-secondary)", borderBottom: "1px solid var(--color-border-light)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inv.strings.map((s) => {
                      const pct = maxStrI > 0 ? (s.current / maxStrI) * 100 : 0;
                      const ok = pct >= 70 || s.current === 0;
                      return (
                        <tr key={s.idx} style={{ borderBottom: "1px solid var(--color-border-light)", background: !ok && s.current > 0 ? "#FEF9F9" : undefined }}>
                          <td style={{ padding: "5px 10px", fontWeight: 600 }}>S{s.idx}</td>
                          <td style={{ padding: "5px 10px", color: "var(--color-text-secondary)" }}>{s.mpptIdx}</td>
                          <td style={{ padding: "5px 10px", color: !ok && s.current > 0 ? "#DC2626" : undefined, fontWeight: !ok && s.current > 0 ? 700 : undefined }}>{s.current ?? "—"}</td>
                          <td style={{ padding: "5px 10px" }}>{s.voltage ?? "—"}</td>
                          <td style={{ padding: "5px 10px" }}>
                            {s.current === 0 ? <span style={{ color: "#9CA3AF" }}>Offline</span> :
                             !ok ? <span style={{ color: "#DC2626", fontWeight: 600 }}>⚠ Low</span> :
                             <span style={{ color: "#0E9B65" }}>Normal</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Charts Tab ─────────────────────────────────────────────────────────────
function ChartsTab({ plant, historyData }) {
  const [powerCurve,    setPowerCurve]    = useState(null);
  const [pcLoading,     setPcLoading]     = useState(true);
  const [monthlyData,   setMonthlyData]   = useState(null);
  const [monthLoading,  setMonthLoading]  = useState(true);
  const [activeChart,   setActiveChart]   = useState("power");
  // SOLARBULL-IMPROVEMENT: Task 11 — 7D/30D/90D history toggle
  const [historyDays,   setHistoryDays]   = useState(7);
  const [historyFetch,  setHistoryFetch]  = useState(null);
  const [histLoading,   setHistLoading]   = useState(false);

  useEffect(() => {
    getPowerCurve(plant.id)
      .then((d) => setPowerCurve(d))
      .catch(() => {})
      .finally(() => setPcLoading(false));
    getMonthlyChart(plant.id)
      .then((d) => setMonthlyData(d))
      .catch(() => {})
      .finally(() => setMonthLoading(false));
  }, [plant.id]);

  // Fetch history when days selection changes
  useEffect(() => {
    if (activeChart !== "7day") return;
    setHistLoading(true);
    getPlantHistory(plant.id, historyDays)
      .then((d) => setHistoryFetch(d?.data || []))
      .catch(() => setHistoryFetch([]))
      .finally(() => setHistLoading(false));
  }, [plant.id, historyDays, activeChart]);

  const pcData = (powerCurve?.data || []).map((d) => ({
    name: d.ts?.slice(11, 16) || d.ts,
    value: d.value,
  }));

  const dailyData = (monthlyData?.daily || []).map((d) => ({
    name: d.date?.slice(8), energy: d.energy,
  }));
  const monthlyBars = (monthlyData?.monthly || []).map((d) => ({
    name: d.month?.slice(0, 7), energy: d.energy,
  }));

  const chartBtn = (key, label) => (
    <button key={key} onClick={() => setActiveChart(key)} style={{
      padding: "6px 14px", fontSize: 12, fontWeight: activeChart === key ? 600 : 400,
      background: activeChart === key ? "var(--sb-orange)" : "var(--color-background-secondary)",
      color: activeChart === key ? "#fff" : "var(--color-text-secondary)",
      border: "none", borderRadius: 6,
    }}>{label}</button>
  );

  const card = (title, children, loading) => (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{title}</div>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <div style={{ width: 30, height: 30, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : children}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Chart switcher */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {chartBtn("power",   "⚡ Intraday Power (kW)")}
        {chartBtn("daily",   "📅 Daily Energy (Month)")}
        {chartBtn("monthly", "📊 Monthly Trend (12M)")}
        {chartBtn("7day",    "📈 7-Day History")}
        {chartBtn("radar",   "🎯 Performance Radar")}
      </div>

      {activeChart === "power" && card("Today — Active Power Curve (kW)", (
        pcData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={pcData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pcGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F7941D" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#F7941D" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v} kW`} />
              <Tooltip formatter={(v) => [`${v} kW`, "Active Power"]} labelFormatter={(l) => `Time: ${l}`} />
              <Area type="monotone" dataKey="value" stroke="#F7941D" strokeWidth={2.5} fill="url(#pcGrad)" dot={false} />
              {plant.currentPower != null && (
                <ReferenceLine y={plant.currentPower} stroke="#DC2626" strokeDasharray="4 4" label={{ value: "Now", fontSize: 10, fill: "#DC2626" }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 40 }}>No intraday data</div>
      ), pcLoading)}

      {activeChart === "daily" && card("This Month — Daily Generation (kWh)", (
        dailyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
              <Tooltip formatter={(v) => [`${v} kWh`, "Energy"]} labelFormatter={(l) => `Day ${l}`} />
              <Bar dataKey="energy" name="Energy (kWh)" fill="var(--sb-orange)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 40 }}>No data</div>
      ), monthLoading)}

      {activeChart === "monthly" && card("12-Month Energy Trend (kWh)", (
        monthlyBars.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyBars} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}K` : v} />
              <Tooltip formatter={(v) => [`${v.toLocaleString("en-IN")} kWh`, "Energy"]} />
              <Bar dataKey="energy" name="Monthly kWh" fill="var(--sb-blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 40 }}>No data</div>
      ), monthLoading)}

      {/* SOLARBULL-IMPROVEMENT: Task 11 — 7D/30D/90D history toggle */}
      {activeChart === "7day" && card(
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span>Generation History</span>
          <div style={{ display: "flex", gap: 4 }}>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setHistoryDays(d)} style={{
                padding: "4px 10px", fontSize: 11, fontWeight: historyDays === d ? 700 : 400,
                background: historyDays === d ? "var(--sb-orange)" : "var(--color-background-secondary)",
                color: historyDays === d ? "#fff" : "var(--color-text-secondary)",
                border: "none", borderRadius: 6, cursor: "pointer",
              }}>{d}D</button>
            ))}
          </div>
        </div>,
        (() => {
          const data = historyFetch || historyData;
          return data.length ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: historyDays > 7 ? 9 : 11 }} tickLine={false} axisLine={false}
                    interval={historyDays > 30 ? 6 : historyDays > 7 ? 2 : 0} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [`${v} kWh`, "Energy"]} />
                  <Bar dataKey="energy" fill="var(--sb-orange)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginTop: 16 }}>
                {[
                  { label: `${historyDays}-Day Total`,  value: `${fmt(Math.round(data.reduce((s, d) => s + d.energy, 0)))} kWh` },
                  { label: "Daily Average", value: `${fmt(Math.round(data.reduce((s, d) => s + d.energy, 0) / data.length))} kWh` },
                  { label: "Best Day",      value: `${fmt(Math.max(...data.map((d) => d.energy)))} kWh` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
                  </div>
                ))}
              </div>
            </>
          ) : <div style={{ color: "var(--color-text-tertiary)", textAlign: "center", padding: 40 }}>No history data</div>;
        })(),
        histLoading
      )}

      {activeChart === "radar" && card("Performance Radar", (
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={[
            { metric: "PR",    value: plant.performanceRatio ? Math.min(100, plant.performanceRatio * 100) : 0 },
            { metric: "CF%",   value: plant.capacityFactor ? Math.min(100, plant.capacityFactor) : 0 },
            { metric: "Avail", value: plant.status === "online" ? 98 : plant.status === "warning" ? 80 : 30 },
            { metric: "Yield", value: plant.specificYield ? Math.min(100, (plant.specificYield / 7) * 100) : 0 },
          ]} cx="50%" cy="50%" outerRadius={100}>
            <PolarGrid stroke="var(--color-border-light)" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }} />
            <Radar name="Plant" dataKey="value" stroke="var(--sb-orange)" fill="var(--sb-orange)" fillOpacity={0.25} />
          </RadarChart>
        </ResponsiveContainer>
      ), false)}
    </div>
  );
}

// ─── Inverter Detail Modal ───────────────────────────────────────────────────
function InverterModal({ inv, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={onClose}>
      <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 24, maxWidth: 700, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-xl)" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{inv.model}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>SN: {inv.sn}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {/* AC */}
          <div>
            <SectionTitle color="#1E5BA6">AC Output</SectionTitle>
            <Param label="Active Power"    value={V(inv.activePower, "kW")} accent="#F7941D" />
            <Param label="Reactive Power"  value={V(inv.reactivePower, "kVAR")} />
            <Param label="Apparent Power"  value={V(inv.apparentPower, "kVA")} />
            <Param label="Power Factor"    value={inv.powerFactor != null ? fmtDec(inv.powerFactor, 3) : "—"} />
            <Param label="Frequency"       value={V(inv.frequency, "Hz")} />
            <Param label="Phase A Voltage" value={V(inv.voltageA, "V")} />
            <Param label="Phase B Voltage" value={V(inv.voltageB, "V")} />
            <Param label="Phase C Voltage" value={V(inv.voltageC, "V")} />
            <Param label="Phase A Current" value={V(inv.currentA, "A")} />
            <Param label="Phase B Current" value={V(inv.currentB, "A")} />
            <Param label="Phase C Current" value={V(inv.currentC, "A")} />
            {inv.voltageAB && <Param label="Line Voltage AB" value={V(inv.voltageAB, "V")} />}
            {inv.voltageBC && <Param label="Line Voltage BC" value={V(inv.voltageBC, "V")} />}
            {inv.voltageCA && <Param label="Line Voltage CA" value={V(inv.voltageCA, "V")} />}
          </div>
          {/* DC */}
          <div>
            <SectionTitle color="#F7941D">DC / MPPT</SectionTitle>
            <Param label="Total DC Power" value={V(inv.totalDCPower, "kW")} accent="#F7941D" />
            <Param label="Bus DC Voltage" value={V(inv.busDCVoltage, "V")} />
            {(inv.mppt || []).map((m) => (
              <div key={m.idx}>
                <Param label={`MPPT ${m.idx} Voltage`} value={V(m.voltage, "V")} />
                <Param label={`MPPT ${m.idx} Current`} value={V(m.current, "A")} />
                {m.power != null && <Param label={`MPPT ${m.idx} Power`} value={`${fmtDec(m.power)} kW`} />}
              </div>
            ))}
          </div>
          {/* Thermal + energy */}
          <div>
            <SectionTitle color="#0E9B65">Thermal & Energy</SectionTitle>
            <Param label="Internal Temp"  value={V(inv.tempInternal, "°C")} accent={inv.tempInternal > 75 ? "#DC2626" : undefined} />
            <Param label="Heatsink Temp"  value={V(inv.tempHeatsink, "°C")} accent={inv.tempHeatsink > 85 ? "#DC2626" : undefined} />
            {inv.tempModule  != null && <Param label="Module Temp"   value={V(inv.tempModule, "°C")} />}
            {inv.tempAmbient != null && <Param label="Ambient Temp"  value={V(inv.tempAmbient, "°C")} />}
            {inv.irradiance  != null && <Param label="Irradiance"    value={V(inv.irradiance, "W/m²")} accent="#F7941D" />}
            <Param label="Efficiency"     value={inv.efficiency != null ? `${fmtDec(inv.efficiency)}%` : "—"} />
            <Param label="Today Energy"   value={inv.todayEnergy != null ? `${fmt(inv.todayEnergy)} kWh` : "—"} />
            <Param label="Total Energy"   value={inv.totalEnergy != null ? `${fmt(Math.round(inv.totalEnergy/1000))} MWh` : "—"} />
            <Param label="Running Status" value={inv.runningStatus || inv.status || "—"} />
            <Param label="Last Update"    value={formatDate(inv.lastUpdate)} />
            {inv.rawCount > 0 && <Param label="API Data Points" value={`${inv.rawCount} point codes`} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Financial & Environmental Tab ───────────────────────────────────────────
function FinancialTab({ plant, kpis, co2Total, trees, coal, homes, rev30, rev365, payback, fleetEff }) {
  // Use actual income from iSolarCloud if available; fall back to computed estimate
  const actualTariff    = kpis?.tariffPerKwh || plant.tariffPerKwh || 4.5;
  const todayRevenue    = kpis?.todayIncomeActual ?? plant.revenueToday ?? 0;
  const yearRevenue     = kpis?.yearIncomeActual  ?? null;
  const totalRevenue    = kpis?.totalIncomeActual ?? Math.round((plant.totalEnergy || 0) * actualTariff);
  const fromCloud       = kpis?.todayIncomeActual != null;

  const row = (label, value, hint) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--color-border-light)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, textAlign: "right", maxWidth: 220 }}>{value}</div>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, paddingBottom: 6, borderBottom: "2px solid var(--sb-orange)", display: "inline-block" }}>Financial Performance</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Today Revenue",  value: rupee(Math.round(todayRevenue)),
              sub: fromCloud ? <span style={{ color: "#0E9B65", fontWeight: 600 }}>from iSolarCloud</span> : `@ ₹${actualTariff}/kWh` },
            { label: "Est. Monthly",   value: rupee(rev30),  sub: "Based on today's gen" },
            { label: yearRevenue != null ? "This Year (actual)" : "Est. Annual",
              value: yearRevenue != null ? rupee(Math.round(yearRevenue)) : rupee(rev365),
              sub: yearRevenue != null ? <span style={{ color: "#0E9B65", fontWeight: 600 }}>from iSolarCloud</span> : "300 generation days" },
            { label: "Payback Period", value: payback ? `${payback} yr` : "—", sub: "@ ₹45k/kWp install" },
          ].map(({ label, value, sub }) => (
            <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
        {row("Tariff Rate",
          <span>{`₹${actualTariff}/kWh`}{kpis?.tariffPerKwh ? <span style={{ fontSize: 10, color: "#0E9B65", marginLeft: 6 }}>iSolarCloud</span> : null}</span>,
          kpis?.tariffPerKwh ? "Configured tariff in iSolarCloud" : "Configured in Settings")}
        {row("Lifetime Revenue",   rupee(Math.round(totalRevenue)),
          totalRevenue === kpis?.totalIncomeActual ? "from iSolarCloud" : "Cumulative estimate")}
        {row("LCOE Estimate",      "₹3.5–4.5/kWh", "IRENA India 2024 benchmark")}
        {row("Live Efficiency",    fleetEff ? `${fleetEff}%` : "97–99%", "DC→AC measured")}
        {row("Plant Lifetime",     "25–40 years", "Typical utility-scale solar")}
        {row("Module Warranty",    "25 yr performance, 10 yr product")}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, paddingBottom: 6, borderBottom: "2px solid #0E9B65", display: "inline-block" }}>Environmental Impact (Lifetime)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[
            { label: "CO₂ Avoided",      value: `${fmt(Math.round(co2Total/1000))} t`,  sub: "Grid factor: 0.82 kg/kWh", icon: "🌍" },
            { label: "Equivalent Trees", value: `${fmt(trees)}`,   sub: "@ 21 kg CO₂/tree/yr", icon: "🌳" },
            { label: "Coal Saved",       value: `${coal} t`,       sub: "2.42 kg CO₂ per kg", icon: "⛏" },
            { label: "Homes Powered",    value: `${fmt(homes)} yr`,sub: "1,200 kWh/yr India", icon: "🏠" },
          ].map(({ label, value, sub, icon }) => (
            <div key={label} style={{ background: "#E8F8F1", borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
              <div style={{ fontSize: 11, color: "#065F46", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#065F46" }}>{value}</div>
              <div style={{ fontSize: 11, color: "#6EE7B7", marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
        {row("CO₂ Today",       kpis?.co2Today != null ? `${Math.round(kpis.co2Today)} kg` : `${Math.round((plant.todayEnergy || 0) * 0.82)} kg`,
          kpis?.co2Today != null ? "from iSolarCloud" : "estimated @ 0.82 kg/kWh")}
        {row("SOx Avoided",     `${Math.round((plant.totalEnergy || 0) * 0.00035)} kg`, "Grid displacement")}
        {row("NOx Avoided",     `${Math.round((plant.totalEnergy || 0) * 0.00052)} kg`)}
        {row("Water Saved",     `${fmt(Math.round((plant.totalEnergy || 0) * 2))} L`, "vs thermal: ~2L/kWh cooling")}
        <div style={{ marginTop: 16, padding: "14px 16px", background: "#F0FDF4", borderRadius: 8, border: "1px solid #BBF7D0", fontSize: 12, color: "#065F46" }}>
          🌱 This plant has prevented <strong>{fmt(Math.round(co2Total/1000))} tonnes of CO₂</strong> — equivalent to taking <strong>{fmt(Math.round(co2Total/1000/4.6))} cars off the road</strong> for a year.
        </div>
      </div>
    </div>
  );
}

// ─── Period Compare Tab ──────────────────────────────────────────────────────
function PeriodCompareTab({ plantId }) {
  const today   = new Date();
  const iso     = (d) => d.toISOString().slice(0, 10);
  const nAgo    = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  const monthStart = (d) => iso(new Date(d.getFullYear(), d.getMonth(), 1));
  const monthEnd   = (d) => iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));

  const [p1Start, setP1Start] = useState(nAgo(60));
  const [p1End,   setP1End]   = useState(nAgo(31));
  const [p2Start, setP2Start] = useState(nAgo(30));
  const [p2End,   setP2End]   = useState(iso(today));
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // Quick preset presets
  const presets = [
    {
      label: "Same month last year",
      apply: () => {
        const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const thisMonthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const lastYearStart  = new Date(today.getFullYear() - 1, today.getMonth(), 1);
        const lastYearEnd    = new Date(today.getFullYear() - 1, today.getMonth() + 1, 0);
        setP1Start(iso(lastYearStart)); setP1End(iso(lastYearEnd));
        setP2Start(iso(thisMonthStart)); setP2End(iso(thisMonthEnd));
      },
    },
    {
      label: "Last month vs prev",
      apply: () => {
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonthEnd   = new Date(today.getFullYear(), today.getMonth(), 0);
        const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
        const prevMonthEnd   = new Date(today.getFullYear(), today.getMonth() - 1, 0);
        setP1Start(iso(prevMonthStart)); setP1End(iso(prevMonthEnd));
        setP2Start(iso(lastMonthStart)); setP2End(iso(lastMonthEnd));
      },
    },
    {
      label: "Last 30 vs prev 30",
      apply: () => {
        setP1Start(nAgo(60)); setP1End(nAgo(31));
        setP2Start(nAgo(30)); setP2End(iso(today));
      },
    },
    {
      label: "YTD vs same YTD last year",
      apply: () => {
        const ytdStart     = iso(new Date(today.getFullYear(), 0, 1));
        const ly_ytdStart  = iso(new Date(today.getFullYear() - 1, 0, 1));
        const ly_ytdEnd    = iso(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
        setP1Start(ly_ytdStart); setP1End(ly_ytdEnd);
        setP2Start(ytdStart);    setP2End(iso(today));
      },
    },
  ];

  const run = async () => {
    setLoading(true); setError(""); setData(null);
    try {
      const res = await getPeriodCompare(plantId, {
        p1_start: p1Start.replace(/-/g, ""), p1_end: p1End.replace(/-/g, ""),
        p2_start: p2Start.replace(/-/g, ""), p2_end: p2End.replace(/-/g, ""),
      });
      setData(res);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const cmpCard = (label, v1, v2) => {
    const diff = (v1 && v2) ? ((v2 - v1) / v1 * 100).toFixed(1) : null;
    return (
      <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 6 }}>{label}</div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 10, color: "#F7941D", marginBottom: 2 }}>Period 1</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(Math.round(v1 || 0))}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#1E5BA6", marginBottom: 2 }}>Period 2</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(Math.round(v2 || 0))}</div>
          </div>
          {diff !== null && <Delta pct={parseFloat(diff)} />}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Select Comparison Periods</div>
        {/* Quick presets */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", alignSelf: "center", marginRight: 4 }}>Quick:</span>
          {presets.map((p) => (
            <button key={p.label} onClick={p.apply} style={{ fontSize: 11, padding: "4px 12px", background: "var(--color-background-secondary)", border: "1px solid var(--color-border-light)", borderRadius: 16, color: "var(--sb-blue)", fontWeight: 500, cursor: "pointer" }}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {[["Period 1 (baseline)", p1Start, setP1Start, p1End, setP1End, "#F7941D"],
            ["Period 2 (comparison)", p2Start, setP2Start, p2End, setP2End, "#1E5BA6"]].map(([label, s, setS, e, setE, color]) => (
            <div key={label}>
              <div style={{ fontSize: 12, fontWeight: 600, color, marginBottom: 8 }}>{label}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 3 }}>Start</label>
                  <input type="date" value={s} onChange={(ev) => setS(ev.target.value)} />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "block", marginBottom: 3 }}>End</label>
                  <input type="date" value={e} onChange={(ev) => setE(ev.target.value)} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={run} disabled={loading} style={{ marginTop: 16, background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 600, padding: "9px 20px" }}>
          {loading ? "Loading..." : "Compare Periods"}
        </button>
      </div>

      {error && <div style={{ padding: "10px 14px", background: "var(--color-background-danger)", color: "var(--color-text-danger)", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            {cmpCard("Total Energy (kWh)", data.summary.p1Total, data.summary.p2Total)}
            {cmpCard("Daily Average (kWh)", data.summary.p1Avg, data.summary.p2Avg)}
            {cmpCard("Best Day (kWh)", data.summary.p1Best, data.summary.p2Best)}
            {cmpCard("Days With Data", data.summary.days1WithData ?? data.summary.days1, data.summary.days2WithData ?? data.summary.days2)}
            {cmpCard("Days Covered", data.summary.days1, data.summary.days2)}
          </div>
          <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Daily Generation Overlay</div>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#F7941D", fontWeight: 600 }}>— {data.period1.label}</span>
              <span style={{ fontSize: 12, color: "#1E5BA6", fontWeight: 600 }}>— {data.period2.label}</span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
                <XAxis dataKey="idx" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v, n) => [`${v} kWh`, n === "energy1" ? "Period 1" : "Period 2"]} labelFormatter={(l) => `Day ${l}`} />
                <Legend formatter={(v) => v === "energy1" ? `P1: ${data.period1.label}` : `P2: ${data.period2.label}`} />
                <Line dataKey="energy1" name="energy1" stroke="#F7941D" strokeWidth={2} dot={false} connectNulls />
                <Line dataKey="energy2" name="energy2" stroke="#1E5BA6" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
