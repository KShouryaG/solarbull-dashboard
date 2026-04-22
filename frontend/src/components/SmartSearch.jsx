import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePlants } from "../context/PlantContext.jsx";
import { StatusBadge } from "./Badge.jsx";
import { fmtDec } from "../utils/format.js";
import { sendChatMessage } from "../api.js";

const SUGGESTED = [
  "Which sites are underperforming today?",
  "Summarize this month's generation",
  "Top 3 sites by today's output",
  "Which plants have active alerts?",
];

function getSuggestedWithOffline(plants) {
  const offline = plants.find((p) => p.status === "offline");
  return [
    "Which sites are underperforming today?",
    "Summarize this month's generation",
    offline ? `Why is ${offline.name} offline?` : "Are any sites offline right now?",
    "Top 3 sites by today's output",
  ];
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--color-text-tertiary)",
            display: "inline-block",
            animation: `pulse 1.2s ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export default function SmartSearch() {
  const navigate   = useNavigate();
  const { plants } = usePlants();
  const inputRef   = useRef(null);
  const wrapRef    = useRef(null);

  const [query,    setQuery]    = useState("");
  const [open,     setOpen]     = useState(false);
  const [focused,  setFocused]  = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(false);

  const suggested = getSuggestedWithOffline(plants);

  // Cmd/Ctrl+K opens + focuses; Esc closes
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setFocused(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Click-outside closes
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Site search: query >= 2 chars
  const siteMatches = query.trim().length >= 2
    ? plants
        .filter((p) =>
          (p.name + (p.city || "")).toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 4)
    : [];

  const showDropdown = open || focused;

  const send = useCallback(async (text) => {
    const q = (text || query).trim();
    if (!q || loading) return;
    setQuery("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const { answer } = await sendChatMessage(q);
      setMessages((m) => [...m, { role: "assistant", text: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Error: ${e.message}`, error: true }]);
    }
    setLoading(false);
  }, [query, loading]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const borderColor = focused ? "#1E5BA6" : "#F7941D";
  const glow        = focused
    ? "0 0 0 3px rgba(30,91,166,0.15), 0 4px 16px rgba(0,0,0,0.08)"
    : "0 0 0 2px rgba(247,148,29,0.18), 0 2px 8px rgba(0,0,0,0.06)";

  const hasConversation = messages.length > 0;
  const hasSiteMatches  = siteMatches.length > 0;
  const showSuggested   = !hasSiteMatches && !hasConversation;

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, maxWidth: 760 }}>
      {/* Search bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        height: 56, padding: "0 16px",
        background: "var(--color-background-primary)",
        border: `2px solid ${borderColor}`,
        borderRadius: 14,
        boxShadow: glow,
        transition: "border-color 0.18s, box-shadow 0.18s",
        cursor: "text",
      }}
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {/* Logo mark */}
        <img
          src="/logo-mark.png"
          height={34}
          width={34}
          alt=""
          style={{ objectFit: "contain", flexShrink: 0, borderRadius: 6 }}
        />

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Ask SolarBull AI or search sites, alerts, clients..."
          style={{
            flex: 1, border: "none", background: "transparent",
            fontSize: 15, color: "var(--color-text-primary)",
            outline: "none", padding: 0,
          }}
        />

        {/* Cmd K chip */}
        <kbd style={{
          fontSize: 11, padding: "3px 7px",
          background: "var(--color-background-secondary)",
          border: "1px solid var(--color-border-light)",
          borderRadius: 6, color: "var(--color-text-tertiary)",
          fontFamily: "inherit", flexShrink: 0,
          display: "flex", alignItems: "center", gap: 3,
        }}>
          <span style={{ fontSize: 13 }}>&#8984;</span>K
        </kbd>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0,
          background: "var(--color-background-primary)",
          border: "1px solid var(--color-border-light)",
          borderRadius: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          zIndex: 500,
          overflow: "hidden",
          maxHeight: "min(520px, calc(100vh - 140px))",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ overflowY: "auto", flex: 1 }}>

            {/* Conversation history */}
            {hasConversation && (
              <div style={{ padding: "12px 14px 4px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: 10 }}>
                  Conversation
                </div>
                {messages.map((m, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: 8, gap: 8, alignItems: "flex-end",
                  }}>
                    {m.role === "assistant" && (
                      <img src="/logo-mark.png" width={22} height={22} alt="" style={{ borderRadius: 4, flexShrink: 0, marginBottom: 2 }} />
                    )}
                    <div style={{
                      maxWidth: "82%",
                      padding: "8px 12px",
                      borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
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
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 8 }}>
                    <img src="/logo-mark.png" width={22} height={22} alt="" style={{ borderRadius: 4, flexShrink: 0 }} />
                    <div style={{ padding: "10px 14px", background: "var(--color-background-secondary)", borderRadius: "14px 14px 14px 4px" }}>
                      <TypingDots />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Site matches */}
            {hasSiteMatches && (
              <div style={{ padding: hasConversation ? "4px 0 0" : "12px 0 0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--color-text-tertiary)", padding: "0 14px", marginBottom: 4 }}>
                  Sites
                </div>
                {siteMatches.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => { navigate(`/plants/${p.id}`); setOpen(false); setQuery(""); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "9px 14px", cursor: "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--color-background-secondary)"}
                    onMouseOut={(e)  => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>
                        {p.city && <>{p.city} · </>}{fmtDec(p.capacity)} kWp
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                    <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>&#8594;</span>
                  </div>
                ))}
              </div>
            )}

            {/* Suggested questions */}
            {showSuggested && (
              <div style={{ padding: "12px 0 4px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--color-text-tertiary)", padding: "0 14px", marginBottom: 4 }}>
                  Try asking
                </div>
                {suggested.map((s) => (
                  <div
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      padding: "9px 14px", cursor: "pointer", fontSize: 13,
                      color: "var(--color-text-primary)",
                      display: "flex", alignItems: "center", gap: 10,
                      transition: "background 0.1s",
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--color-background-secondary)"}
                    onMouseOut={(e)  => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ color: "var(--sb-orange)", fontSize: 14, flexShrink: 0 }}>&#10022;</span>
                    {s}
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* Footer hint */}
          <div style={{
            padding: "8px 14px",
            borderTop: "1px solid var(--color-border-light)",
            fontSize: 11, color: "var(--color-text-tertiary)",
            display: "flex", gap: 12,
          }}>
            <span>&#8629; to ask</span>
            <span>Esc to close</span>
            {hasSiteMatches && <span>Click site to open</span>}
          </div>
        </div>
      )}
    </div>
  );
}
