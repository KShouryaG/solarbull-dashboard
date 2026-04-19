import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const handle = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError("Enter username and password"); return; }
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err.message || "Login failed");
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0F2A5C 0%, #1E5BA6 60%, #2471C8 100%)",
      padding: 16,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src="/logo.png" alt="SolarBull" style={{ height: 52, filter: "brightness(0) invert(1)" }} />
          <div style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            Solar Solutions Simplified
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "#fff", borderRadius: "var(--border-radius-xl)", padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Welcome back</h2>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 24 }}>Sign in to your dashboard</p>

          <form onSubmit={handle}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your username"
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === "Enter" && handle(e)}
              />
            </div>

            {error && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--color-background-danger)", color: "var(--color-text-danger)", borderRadius: "var(--border-radius-md)", fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", padding: "12px", fontSize: 15, fontWeight: 600,
                background: loading ? "#ccc" : "var(--sb-orange)",
                color: "#fff", border: "none",
                borderRadius: "var(--border-radius-md)",
                boxShadow: loading ? "none" : "0 4px 12px rgba(247,148,29,0.35)",
                transition: "all 0.2s",
              }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
          SolarBull Energy · Confidential
        </div>
      </div>
    </div>
  );
}
