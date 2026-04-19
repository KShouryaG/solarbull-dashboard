import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "../api.js";
import { useAuth } from "../auth.jsx";

function Section({ title, children }) {
  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: 24, boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 20, paddingBottom: 10, borderBottom: "2px solid var(--sb-orange)", display: "inline-block" }}>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, alignItems: "flex-start", padding: "12px 0", borderBottom: "1px solid var(--color-border-light)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [form,    setForm]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    getSettings().then(setForm).catch(console.error);
  }, []);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveSettings(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message || "Save failed");
    }
    setSaving(false);
  };

  if (!form) return (
    <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
      <div style={{ width: 36, height: 36, border: "3px solid var(--color-border-light)", borderTopColor: "var(--sb-orange)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  const isAdmin = user?.role === "admin";

  return (
    <div className="fade-in" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Settings</h1>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
          Configure KPI thresholds, tariffs, and platform preferences
        </div>
      </div>

      {!isAdmin && (
        <div style={{ background: "#FFF8E8", border: "1px solid #F7941D", borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#B45309" }}>
          ℹ View-only — only admins can change settings.
        </div>
      )}

      <Section title="Financial Parameters">
        <Field label="Tariff Rate" hint="Revenue per kWh generated">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" step="0.1" min="0"
              value={form.tariffPerKwh}
              onChange={(e) => set("tariffPerKwh", parseFloat(e.target.value))}
              disabled={!isAdmin}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>₹ / kWh</span>
          </div>
        </Field>
        <Field label="Currency" hint="Display currency for revenue">
          <select value={form.currency} onChange={(e) => set("currency", e.target.value)} disabled={!isAdmin} style={{ width: 120 }}>
            <option value="INR">INR (₹)</option>
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </Field>
      </Section>

      <Section title="Solar KPI Reference Values">
        <Field label="Peak Sun Hours" hint="Daily solar irradiance reference for PR calc">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" step="0.1" min="1" max="12"
              value={form.peakSunHours}
              onChange={(e) => set("peakSunHours", parseFloat(e.target.value))}
              disabled={!isAdmin}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>hours/day (India default: 5.5)</span>
          </div>
        </Field>
        <Field label="CO₂ Factor" hint="Grid emission factor for CO₂ avoided calculation">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" step="0.01" min="0"
              value={form.co2Factor}
              onChange={(e) => set("co2Factor", parseFloat(e.target.value))}
              disabled={!isAdmin}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>kg CO₂ / kWh (India grid: 0.82)</span>
          </div>
        </Field>
      </Section>

      <Section title="Performance Grade Thresholds (PR-based)">
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12, padding: "8px 12px", background: "var(--color-background-secondary)", borderRadius: 6 }}>
          Performance Ratio = Specific Yield / Peak Sun Hours. Grades are assigned based on the thresholds below.
        </div>
        <Field label="Excellent ≥" hint="Plants at this PR or above are Excellent">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" step="0.01" min="0" max="1"
              value={form.prExcellent}
              onChange={(e) => set("prExcellent", parseFloat(e.target.value))}
              disabled={!isAdmin}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 13, color: "#0E9B65", fontWeight: 600 }}>Excellent</span>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>(e.g. 0.80 = 80%)</span>
          </div>
        </Field>
        <Field label="Good ≥" hint="Above this but below Excellent → Good">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" step="0.01" min="0" max="1"
              value={form.prGood}
              onChange={(e) => set("prGood", parseFloat(e.target.value))}
              disabled={!isAdmin}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 13, color: "#1E5BA6", fontWeight: 600 }}>Good</span>
          </div>
        </Field>
        <Field label="Fair ≥" hint="Above this but below Good → Fair. Below this → Poor">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number" step="0.01" min="0" max="1"
              value={form.prFair}
              onChange={(e) => set("prFair", parseFloat(e.target.value))}
              disabled={!isAdmin}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 13, color: "#F7941D", fontWeight: 600 }}>Fair</span>
          </div>
        </Field>
      </Section>

      <Section title="Platform">
        <Field label="Company Name" hint="Shown in reports and headers">
          <input
            type="text"
            value={form.companyName}
            onChange={(e) => set("companyName", e.target.value)}
            disabled={!isAdmin}
            style={{ width: 280 }}
          />
        </Field>
        <Field label="Timezone" hint="Used for date/time display">
          <select value={form.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={!isAdmin} style={{ width: 200 }}>
            <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
            <option value="UTC">UTC</option>
            <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4)</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </select>
        </Field>
      </Section>

      {/* KPI Reference table (read-only) */}
      <Section title="KPI Reference — India Solar Benchmarks">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {["KPI", "Excellent", "Good", "Fair/Typical", "Source"].map((h) => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--color-text-secondary)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Performance Ratio (PR)",    "≥ 80%",       "70–80%",       "55–70%",  "IEC 61724"],
              ["Specific Yield (kWh/kWp)",  "≥ 5.5",       "4.5–5.5",      "3.5–4.5", "CERC India"],
              ["Availability Factor",        "≥ 98%",       "95–98%",       "90–95%",  "IEC 61724"],
              ["Module Efficiency (mono)",   "≥ 22%",       "20–22%",       "18–20%",  "NREL/IEC"],
              ["Inverter Efficiency",        "≥ 98.5%",     "97–98.5%",     "95–97%",  "IEC 61683"],
              ["Annual Degradation",         "≤ 0.3%/yr",   "0.3–0.5%/yr", "0.5–0.8%/yr", "NREL 2022"],
              ["LCOE (India 2024)",          "≤ ₹2.5/kWh", "₹2.5–4/kWh", "₹4–6/kWh", "IRENA/MNRE"],
              ["Capacity Factor",            "≥ 25%",       "18–25%",      "12–18%",   "MNRE India"],
            ].map(([kpi, exc, good, fair, src]) => (
              <tr key={kpi} style={{ borderTop: "1px solid var(--color-border-light)" }}>
                <td style={{ padding: "9px 12px", fontWeight: 500 }}>{kpi}</td>
                <td style={{ padding: "9px 12px", color: "#0E9B65", fontWeight: 600 }}>{exc}</td>
                <td style={{ padding: "9px 12px", color: "#1E5BA6" }}>{good}</td>
                <td style={{ padding: "9px 12px", color: "#F7941D" }}>{fair}</td>
                <td style={{ padding: "9px 12px", color: "var(--color-text-tertiary)", fontSize: 11 }}>{src}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Save button */}
      {isAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 700, padding: "10px 28px", fontSize: 14 }}
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saved && <span style={{ color: "#0E9B65", fontWeight: 600, fontSize: 13 }}>✓ Settings saved successfully</span>}
          {error && <span style={{ color: "#DC2626", fontSize: 13 }}>✗ {error}</span>}
        </div>
      )}
    </div>
  );
}
