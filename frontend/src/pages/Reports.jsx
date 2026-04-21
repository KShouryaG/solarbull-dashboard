import { useState, useEffect, useMemo } from "react";
import { usePlants } from "../context/PlantContext.jsx";
import MetricCard from "../components/MetricCard.jsx";
import { GradeBadge, StatusBadge } from "../components/Badge.jsx";
import { fmt, fmtDec, fmtPct, rupee } from "../utils/format.js";
import { GRADE_COLORS } from "../utils/computed.js";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export default function Reports() {
  const { plants, loading, fetchPlants } = usePlants();
  const [sortBy,  setSortBy]  = useState("todayEnergy");
  const [filter,  setFilter]  = useState("all");

  useEffect(() => { fetchPlants(); }, []);

  const totals = useMemo(() => {
    const ps      = filter === "all" ? plants : plants.filter((p) => p.status === filter);
    const totalCap  = ps.reduce((s, p) => s + (p.capacity || 0), 0);
    const todayGen  = ps.reduce((s, p) => s + (p.todayEnergy || 0), 0);
    const totalCO2  = ps.reduce((s, p) => s + (p.co2Avoided || p.co2 || 0), 0);
    const totalRev  = ps.reduce((s, p) => s + (p.revenueToday || 0), 0);
    const totalMWh  = ps.reduce((s, p) => s + (p.totalEnergy || 0), 0);
    const activePR  = ps.filter((p) => p.performanceRatio);
    const avgPR     = activePR.length ? activePR.reduce((s, p) => s + p.performanceRatio, 0) / activePR.length : null;
    const online    = ps.filter((p) => p.status === "online").length;
    const warning   = ps.filter((p) => p.status === "warning").length;
    const offline   = ps.filter((p) => p.status === "offline").length;
    const totalAlertsCount = ps.reduce((s, p) => s + (p.errors?.length || 0), 0);
    return { totalCap, todayGen, totalCO2, totalRev, avgPR, online, warning, offline, totalMWh, totalAlertsCount, count: ps.length };
  }, [plants, filter]);

  const displayPlants = useMemo(() => {
    let f = filter === "all" ? plants : plants.filter((p) => p.status === filter);
    return [...f].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
  }, [plants, filter, sortBy]);

  const gradeDist = useMemo(() => {
    const c = {};
    displayPlants.forEach((p) => { c[p.grade || "N/A"] = (c[p.grade || "N/A"] || 0) + 1; });
    return Object.entries(c).map(([name, value]) => ({ name, value, color: GRADE_COLORS[name] || "#ccc" }));
  }, [displayPlants]);

  const top10 = useMemo(() =>
    [...displayPlants].slice(0, 10).map((p) => ({
      name: p.name.split(" ").slice(-2).join(" "), value: p[sortBy] || 0, grade: p.grade,
    })),
    [displayPlants, sortBy]);

  // ── Export CSV ─────────────────────────────────
  const exportCSV = () => {
    const headers = ["Name","City","Status","Grade","Capacity (kWp)","Today (kWh)","Month (kWh)","Total (MWh)","PR (%)","Specific Yield","CF%","CO2 Avoided (kg)","Revenue Today (INR)","Alerts"];
    const rows = plants.map((p) => [
      p.name, p.city || "", p.status, p.grade, fmtDec(p.capacity),
      p.todayEnergy || 0, p.monthEnergy || "",
      ((p.totalEnergy || 0) / 1000).toFixed(1),
      p.performanceRatio ? (p.performanceRatio * 100).toFixed(2) : "",
      p.specificYield || "", p.capacityFactor || "",
      Math.round(p.co2Avoided || p.co2 || 0), Math.round(p.revenueToday || 0),
      p.errors?.length || 0,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = `solarbull-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ── Export Excel ───────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      ["SolarBull Energy — Fleet Report", "", `Generated: ${new Date().toLocaleString("en-IN")}`],
      [],
      ["Metric", "Value"],
      ["Total Plants",        plants.length],
      ["Total Capacity (kWp)", Math.round(totals.totalCap)],
      ["Today's Generation (kWh)", Math.round(totals.todayGen)],
      ["Lifetime Generation (MWh)", Math.round(totals.totalMWh / 1000)],
      ["Fleet Avg PR",        totals.avgPR ? `${(totals.avgPR * 100).toFixed(1)}%` : "—"],
      ["CO₂ Avoided (kg)",    Math.round(totals.totalCO2)],
      ["Today Revenue (INR)", Math.round(totals.totalRev)],
      ["Plants Online",       totals.online],
      ["Plants Warning",      totals.warning],
      ["Plants Offline",      totals.offline],
      ["Active Alerts",       totals.totalAlertsCount],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "Summary");

    // Sheet 2: Plant Data
    const headers = ["Name","City","Status","Grade","Capacity (kWp)","Today (kWh)","Month (kWh)","Total Energy (MWh)","Performance Ratio (%)","Specific Yield (kWh/kWp)","Capacity Factor (%)","CO2 Avoided (kg)","Revenue Today (INR)","Active Alerts","Latitude","Longitude","Install Date"];
    const rows = plants.map((p) => [
      p.name, p.city || "", p.status, p.grade, p.capacity || 0,
      p.todayEnergy || 0, p.monthEnergy || 0,
      +((p.totalEnergy || 0) / 1000).toFixed(1),
      p.performanceRatio ? +(p.performanceRatio * 100).toFixed(2) : "",
      p.specificYield || "", p.capacityFactor || "",
      Math.round(p.co2Avoided || p.co2 || 0),
      Math.round(p.revenueToday || 0),
      p.errors?.length || 0,
      p.latitude || "", p.longitude || "", p.installDate || "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Plant Data");

    // Sheet 3: Alerts
    const alertHeaders = ["Plant","Plant ID","Error Code","Description","Severity","Device SN","Timestamp","Recommended Fix"];
    const alertRows = [];
    plants.forEach((p) => {
      (p.errors || []).forEach((e) => {
        alertRows.push([p.name, p.id, e.code, e.desc, e.severity, e.deviceSn || "", e.timestamp || "", e.fix || ""]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([alertHeaders, ...alertRows]), "Alerts");

    XLSX.writeFile(wb, `solarbull-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── Export PDF ─────────────────────────────────
  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const now = new Date().toLocaleString("en-IN");
    const ORANGE = [247, 148, 29];
    const BLUE   = [30, 91, 166];
    const W = doc.internal.pageSize.getWidth();

    // Header
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, W, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("SolarBull Energy — Fleet Report", 12, 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated: ${now}  |  Plants: ${plants.length}  |  Total Capacity: ${Math.round(totals.totalCap)} kWp`, 12, 17);

    // KPI summary boxes
    const kpis = [
      ["Today Generated", `${fmt(Math.round(totals.todayGen))} kWh`],
      ["Fleet Avg PR",    totals.avgPR ? `${(totals.avgPR*100).toFixed(1)}%` : "—"],
      ["CO₂ Avoided",    `${fmt(Math.round(totals.totalCO2/1000))} t`],
      ["Today Revenue",  `${rupee(Math.round(totals.totalRev))}`],
      ["Online / Total", `${totals.online} / ${totals.count}`],
      ["Active Alerts",  String(totals.totalAlertsCount)],
    ];
    let kpiX = 12;
    doc.setTextColor(0, 0, 0);
    kpis.forEach(([label, value]) => {
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(kpiX, 26, 43, 18, 2, 2, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 110, 130);
      doc.text(label, kpiX + 2, 31);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...ORANGE);
      doc.text(value, kpiX + 2, 39);
      kpiX += 45;
    });

    // Plant data table
    autoTable(doc, {
      startY: 48,
      head: [["#","Plant","City","Status","Grade","Cap (kWp)","Today (kWh)","Lifetime (MWh)","PR%","Alerts"]],
      body: displayPlants.map((p, i) => [
        i + 1, p.name, p.city || "—", p.status, p.grade || "—",
        fmtDec(p.capacity), fmt(p.todayEnergy),
        fmt(+((p.totalEnergy||0)/1000).toFixed(1)),
        p.performanceRatio ? `${(p.performanceRatio*100).toFixed(1)}%` : "—",
        p.errors?.length || 0,
      ]),
      headStyles: { fillColor: BLUE, textColor: 255, fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 7.5, cellPadding: 2 },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 52 }, 4: { cellWidth: 20 } },
      didDrawPage: (data) => {
        // Footer
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`SolarBull Energy — Confidential  |  Page ${data.pageNumber}`, 12, doc.internal.pageSize.getHeight() - 5);
      },
    });

    doc.save(`SolarBull-Report-${new Date().toISOString().slice(0,10)}.pdf`);
  };

  // ── Export Word ─────────────────────────────────
  const exportWord = async () => {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType, ShadingType } = await import("docx");

    const rows = displayPlants.map((p) => new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: p.name, size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: p.city || "—", size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: p.status, size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: p.grade || "—", size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: fmtDec(p.capacity), size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(fmt(p.todayEnergy)), size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: p.performanceRatio ? `${(p.performanceRatio*100).toFixed(1)}%` : "—", size: 16 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(p.errors?.length || 0), size: 16 })] })] }),
      ],
    }));

    const headerCells = ["Plant Name","City","Status","Grade","Capacity (kWp)","Today (kWh)","PR%","Alerts"].map((h) =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: "1E5BA6" },
        children: [new Paragraph({ children: [new TextRun({ text: h, color: "FFFFFF", bold: true, size: 16 })] })],
      })
    );

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: "SolarBull Energy — Fleet Report", bold: true, size: 36, color: "1E5BA6" })],
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [new TextRun({ text: `Generated: ${new Date().toLocaleString("en-IN")}  |  Plants: ${plants.length}  |  Capacity: ${Math.round(totals.totalCap)} kWp`, size: 20, color: "888888" })],
          }),
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          new Paragraph({
            children: [
              new TextRun({ text: `Today: ${fmt(Math.round(totals.todayGen))} kWh  |  `, size: 22 }),
              new TextRun({ text: `Avg PR: ${totals.avgPR ? `${(totals.avgPR*100).toFixed(1)}%` : "—"}  |  `, size: 22 }),
              new TextRun({ text: `CO₂ Avoided: ${fmt(Math.round(totals.totalCO2/1000))} t  |  `, size: 22 }),
              new TextRun({ text: `Revenue: ${rupee(Math.round(totals.totalRev))}  |  `, size: 22 }),
              new TextRun({ text: `Online: ${totals.online}/${totals.count}`, size: 22 }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: headerCells, tableHeader: true }), ...rows],
          }),
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "SolarBull Energy — Confidential", size: 16, color: "999999" })],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `SolarBull-Report-${new Date().toISOString().slice(0,10)}.docx`);
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Fleet Reports</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Aggregate KPIs, charts, and exportable data — {plants.length} plants
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="all">All plants</option>
            <option value="online">Online only</option>
            <option value="warning">Warning only</option>
            <option value="offline">Offline only</option>
          </select>
          <button onClick={exportPDF} style={{ background: "#DC2626", color: "#fff", border: "none", fontWeight: 600, padding: "9px 16px" }}>
            ↓ PDF
          </button>
          <button onClick={exportWord} style={{ background: "#1E5BA6", color: "#fff", border: "none", fontWeight: 600, padding: "9px 16px" }}>
            ↓ Word
          </button>
          <button onClick={exportExcel} style={{ background: "#0E9B65", color: "#fff", border: "none", fontWeight: 600, padding: "9px 16px" }}>
            ↓ Excel
          </button>
          <button onClick={exportCSV} style={{ background: "transparent", color: "var(--sb-blue)", border: "1px solid var(--sb-blue)", fontWeight: 600, padding: "9px 16px" }}>
            ↓ CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 12, marginBottom: 24 }}>
        <MetricCard label="Total Capacity"    value={`${fmt(Math.round(totals.totalCap))} kWp`}     icon="⚡" sub={`${totals.count} plants`} />
        <MetricCard label="Today Generated"   value={`${fmt(Math.round(totals.todayGen))} kWh`}     accent="var(--sb-orange)" icon="☀" />
        <MetricCard label="Lifetime Gen"      value={`${fmt(Math.round(totals.totalMWh/1000))} MWh`} icon="🏆" />
        <MetricCard label="Fleet Avg PR"      value={totals.avgPR ? fmtPct(totals.avgPR) : "—"}     accent="var(--sb-blue)" icon="📊" />
        <MetricCard label="CO₂ Avoided"       value={`${fmt(Math.round(totals.totalCO2/1000))} t`}  accent="#0E9B65" icon="🌿" sub={`${fmt(Math.round(totals.totalCO2/21))} trees`} />
        <MetricCard label="Today Revenue"     value={rupee(Math.round(totals.totalRev))}             icon="₹" />
        <MetricCard label="Plants Online"     value={`${totals.online}/${totals.count}`}             accent="#0E9B65" icon="🏭" sub={`${totals.warning}W · ${totals.offline}O`} />
        <MetricCard label="Active Alerts"     value={String(totals.totalAlertsCount)}                accent={totals.totalAlertsCount > 0 ? "#DC2626" : undefined} icon="⚠" />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Grade pie */}
        <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Grade Distribution</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={gradeDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {gradeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [`${v} plants`, n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Status donut */}
        <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Status Split</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={[
                { name: "Online",  value: totals.online,  color: "#0E9B65" },
                { name: "Warning", value: totals.warning, color: "#F7941D" },
                { name: "Offline", value: totals.offline, color: "#DC2626" },
              ].filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={4}>
                {[0,1,2].map((_, i) => <Cell key={i} fill={["#0E9B65","#F7941D","#DC2626"][i]} />)}
              </Pie>
              <Tooltip formatter={(v, n) => [`${v} plants`, n]} />
              <Legend iconType="circle" iconSize={10} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top plants bar */}
        <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 20, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Top 10 Plants</div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: "auto", fontSize: 11, padding: "3px 6px" }}>
              <option value="todayEnergy">Today kWh</option>
              <option value="totalEnergy">Lifetime kWh</option>
              <option value="capacity">Capacity kWp</option>
              <option value="performanceRatio">Performance Ratio</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={top10} layout="vertical" margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={(v) => sortBy === "performanceRatio" ? `${(v*100).toFixed(0)}%` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={70} />
              <Tooltip formatter={(v) => sortBy === "performanceRatio" ? [`${(v*100).toFixed(1)}%`, "PR"] : [`${fmt(Math.round(v))}`, sortBy]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {top10.map((d, i) => <Cell key={i} fill={GRADE_COLORS[d.grade] || "var(--sb-orange)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Full table */}
      <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Full Fleet Data ({displayPlants.length} plants)</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--color-background-secondary)" }}>
                {["Plant","Status","Grade","Cap (kWp)","Today (kWh)","Lifetime (MWh)","PR","Yield","CF%","CO₂ (kg)","Rev (₹)","Alerts"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Loading…</td></tr>
              ) : displayPlants.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--color-border-light)", borderLeft: `3px solid ${GRADE_COLORS[p.grade] || "#ccc"}` }}
                  onMouseOver={(e) => e.currentTarget.style.background = "var(--color-background-secondary)"}
                  onMouseOut={(e)  => e.currentTarget.style.background = ""}>
                  <td style={{ padding: "9px 12px", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                  <td style={{ padding: "9px 12px" }}><StatusBadge status={p.status} /></td>
                  <td style={{ padding: "9px 12px" }}><GradeBadge grade={p.grade} /></td>
                  <td style={{ padding: "9px 12px" }}>{fmtDec(p.capacity)}</td>
                  <td style={{ padding: "9px 12px" }}>{fmt(p.todayEnergy)}</td>
                  <td style={{ padding: "9px 12px" }}>{fmt(+(((p.totalEnergy||0)/1000).toFixed(1)))}</td>
                  <td style={{ padding: "9px 12px", color: GRADE_COLORS[p.grade], fontWeight: 600 }}>{p.performanceRatio ? fmtPct(p.performanceRatio) : "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{p.specificYield ? fmtDec(p.specificYield) : "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{p.capacityFactor ? fmtDec(p.capacityFactor) : "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{fmt(Math.round(p.co2Avoided || p.co2 || 0))}</td>
                  <td style={{ padding: "9px 12px" }}>{rupee(Math.round(p.revenueToday || 0))}</td>
                  <td style={{ padding: "9px 12px", color: (p.errors?.length || 0) > 0 ? "#DC2626" : "#0E9B65", fontWeight: 600 }}>
                    {p.errors?.length || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
