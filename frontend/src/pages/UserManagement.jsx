import { useState, useEffect } from "react";
import { getUsers, createUser, updateUser, deleteUser } from "../api.js";
import { usePlants } from "../context/PlantContext.jsx";
import { formatDate } from "../utils/format.js";

const EMPTY_FORM = { username: "", password: "", name: "", email: "", role: "client", plant_ids: [] };

export default function UserManagement() {
  const [users,    setUsers]    = useState([]);
  const { plants, fetchPlants } = usePlants();
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [delId,    setDelId]    = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [u] = await Promise.all([getUsers(), fetchPlants()]);
      setUsers(u);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const openCreate = () => { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); setError(""); };
  const openEdit   = (u) => {
    setForm({ username: u.username, password: "", name: u.name, email: u.email || "", role: u.role, plant_ids: JSON.parse(u.plant_ids || "[]") });
    setEditId(u.id);
    setShowForm(true);
    setError("");
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { ...form };
      if (!body.password) delete body.password;
      if (editId) {
        await updateUser(editId, body);
      } else {
        await createUser(body);
      }
      setShowForm(false);
      await reload();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const confirmDelete = async (id) => {
    try {
      await deleteUser(id);
      setDelId(null);
      await reload();
    } catch (e) { setError(e.message); }
  };

  const togglePlant = (pid) => {
    setForm((f) => ({
      ...f,
      plant_ids: f.plant_ids.includes(pid)
        ? f.plant_ids.filter((x) => x !== pid)
        : [...f.plant_ids, pid],
    }));
  };

  const input = (label, key, type = "text", hint) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: .5, marginBottom: 5 }}>
        {label}
      </label>
      <input type={type} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
      {hint && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 3 }}>{hint}</div>}
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>User Management</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            Create client accounts and assign plants
          </div>
        </div>
        <button onClick={openCreate} style={{ background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 600, padding: "9px 18px" }}>
          + Add User
        </button>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--color-background-danger)", color: "var(--color-text-danger)", borderRadius: "var(--border-radius-md)", marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Create / Edit form */}
      {showForm && (
        <div style={{
          background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)",
          border: "1px solid var(--color-border-light)", padding: 24, marginBottom: 24,
          boxShadow: "var(--shadow-md)", animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
            {editId ? "Edit User" : "Create New User"}
          </div>
          <form onSubmit={save}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
              {!editId && input("Username *", "username", "text", "Used to log in")}
              {input("Full Name *", "name")}
              {input(editId ? "New Password" : "Password *", "password", "password", editId ? "Leave blank to keep current" : "")}
              {input("Email", "email", "email")}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: .5, marginBottom: 5 }}>
                Role
              </label>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} style={{ width: "auto" }}>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {form.role === "client" && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: .5, marginBottom: 8 }}>
                  Assigned Plants ({form.plant_ids.length} selected)
                </label>
                <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--color-border-light)", borderRadius: "var(--border-radius-md)", padding: 4 }}>
                  {plants.map((p) => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", cursor: "pointer", borderRadius: 6 }}
                      onMouseOver={(e) => e.currentTarget.style.background = "var(--color-background-secondary)"}
                      onMouseOut={(e)  => e.currentTarget.style.background = ""}>
                      <input
                        type="checkbox"
                        checked={form.plant_ids.includes(p.id)}
                        onChange={() => togglePlant(p.id)}
                        style={{ width: 14, height: 14, cursor: "pointer", accentColor: "var(--sb-orange)" }}
                      />
                      <span style={{ fontSize: 13, flex: 1 }}>{p.name}</span>
                      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{p.capacity ? `${p.capacity} kWp` : ""}</span>
                    </label>
                  ))}
                  {!plants.length && <div style={{ padding: 10, fontSize: 13, color: "var(--color-text-tertiary)" }}>No plants available</div>}
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: "8px 12px", background: "var(--color-background-danger)", color: "var(--color-text-danger)", borderRadius: "var(--border-radius-md)", marginBottom: 14, fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={saving}
                style={{ background: "var(--sb-orange)", color: "#fff", border: "none", fontWeight: 600, padding: "9px 20px" }}>
                {saving ? "Saving..." : editId ? "Save Changes" : "Create User"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} style={{ padding: "9px 16px" }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", boxShadow: "var(--shadow-sm)", border: "1px solid var(--color-border-light)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-background-secondary)" }}>
              {["Username", "Name", "Email", "Role", "Plants", "Created", "Actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "12px 14px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--color-text-secondary)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "var(--color-text-tertiary)" }}>Loading...</td></tr>
            ) : users.map((u) => {
              const ids = JSON.parse(u.plant_ids || "[]");
              return (
                <tr key={u.id} style={{ borderTop: "1px solid var(--color-border-light)" }}
                  onMouseOver={(e) => e.currentTarget.style.background = "var(--color-background-secondary)"}
                  onMouseOut={(e)  => e.currentTarget.style.background = ""}>
                  <td style={{ padding: "12px 14px", fontWeight: 600 }}>{u.username}</td>
                  <td style={{ padding: "12px 14px" }}>{u.name}</td>
                  <td style={{ padding: "12px 14px", color: "var(--color-text-secondary)" }}>{u.email || "—"}</td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{
                      fontSize: 11, padding: "3px 10px", borderRadius: 999, fontWeight: 600,
                      background: u.role === "admin" ? "var(--sb-blue-light)" : "var(--color-background-secondary)",
                      color:      u.role === "admin" ? "var(--sb-blue)"       : "var(--color-text-secondary)",
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", color: "var(--color-text-secondary)" }}>
                    {u.role === "admin" ? "All plants" : ids.length === 0 ? "None" : `${ids.length} plant${ids.length > 1 ? "s" : ""}`}
                  </td>
                  <td style={{ padding: "12px 14px", color: "var(--color-text-secondary)", fontSize: 12 }}>
                    {formatDate(u.created_at, { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => openEdit(u)} style={{ padding: "5px 12px", fontSize: 12, background: "var(--sb-blue-light)", color: "var(--sb-blue)", border: "none", fontWeight: 600 }}>
                        Edit
                      </button>
                      {delId === u.id ? (
                        <>
                          <button onClick={() => confirmDelete(u.id)} style={{ padding: "5px 10px", fontSize: 12, background: "var(--color-background-danger)", color: "var(--color-text-danger)", border: "none", fontWeight: 600 }}>Confirm</button>
                          <button onClick={() => setDelId(null)} style={{ padding: "5px 10px", fontSize: 12 }}>Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setDelId(u.id)} style={{ padding: "5px 10px", fontSize: 12, color: "var(--color-text-danger)", border: "none", background: "none" }}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
