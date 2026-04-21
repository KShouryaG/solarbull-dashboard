import { useState, useRef, useEffect } from "react";
import { sendChatMessage } from "../api.js";

const SUGGESTED = [
  "Which plant has the lowest PR today?",
  "How much CO₂ has my fleet avoided?",
  "Which plants have active alerts?",
  "What is today's total generation?",
  "Which plant is underperforming?",
  "Estimate this month's revenue.",
];

export default function Chatbot() {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi! I'm SolarBull AI. Ask me anything about your fleet — performance, alerts, financials, or recommendations." }
  ]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  const send = async (text) => {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const { answer } = await sendChatMessage(q);
      setMessages((m) => [...m, { role: "assistant", text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Error: ${e.message}`, error: true }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed", bottom: 24, right: 24,
          width: 54, height: 54, borderRadius: "50%",
          background: open ? "#1E5BA6" : "var(--sb-orange)",
          border: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.22)",
          fontSize: 22, cursor: "pointer", zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 0.2s",
        }}
        title="SolarBull AI"
      >
        {open ? "✕" : "🤖"}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 90, right: 24,
          width: "min(380px, calc(100vw - 32px))",
          height: "min(520px, calc(100vh - 120px))",
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-xl)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          border: "1px solid var(--color-border-light)",
          display: "flex", flexDirection: "column",
          zIndex: 199, animation: "fadeIn 0.2s ease",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
            background: "var(--color-background-sidebar)",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--sb-orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🤖</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>SolarBull AI</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Fleet intelligence assistant</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px" }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                marginBottom: 10,
              }}>
                <div style={{
                  maxWidth: "85%",
                  padding: "9px 13px",
                  borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  background: m.role === "user" ? "var(--sb-orange)" : m.error ? "var(--color-background-danger)" : "var(--color-background-secondary)",
                  color: m.role === "user" ? "#fff" : m.error ? "var(--color-text-danger)" : "var(--color-text-primary)",
                  fontSize: 13, lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
                <div style={{ padding: "9px 14px", background: "var(--color-background-secondary)", borderRadius: "16px 16px 16px 4px" }}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-tertiary)", display: "inline-block", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions (shown only when just the welcome message) */}
          {messages.length === 1 && (
            <div style={{ padding: "0 14px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    fontSize: 11, padding: "4px 10px",
                    background: "var(--color-background-secondary)",
                    border: "1px solid var(--color-border-light)",
                    borderRadius: 20, color: "var(--sb-blue)",
                    fontWeight: 500, cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--color-border-light)", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask about your fleet..."
              disabled={loading}
              style={{ flex: 1, fontSize: 13, padding: "8px 12px", borderRadius: 20 }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{
                background: "var(--sb-orange)", border: "none", borderRadius: "50%",
                width: 36, height: 36, fontSize: 14, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, cursor: "pointer",
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
