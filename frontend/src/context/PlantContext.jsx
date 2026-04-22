import { createContext, useContext, useState, useCallback, useRef } from "react";
import { getPlants } from "../api.js";

const PlantContext = createContext(null);

const CACHE_MS = 5 * 60 * 1000; // 5 minutes

export function PlantProvider({ children }) {
  const [plants,  setPlants]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const lastFetch = useRef(0);
  const inflight  = useRef(null);
  const plantsRef = useRef([]); // ref copy — no stale closure

  // Empty deps: fetchPlants is stable (no recreation on every plant update).
  // Cache/inflight checks use refs so they always see current values.
  const fetchPlants = useCallback(async (force = false) => {
    const now = Date.now();
    // Return cached data if still fresh
    if (!force && lastFetch.current > 0 && now - lastFetch.current < CACHE_MS) {
      return plantsRef.current;
    }
    // Deduplicate concurrent calls
    if (inflight.current) return inflight.current;

    setLoading(true);
    setError(null);

    const promise = getPlants()
      .then((d) => {
        const p = d.plants || [];
        plantsRef.current = p;
        setPlants(p);
        lastFetch.current = Date.now();
        return p;
      })
      .catch((e) => {
        console.error("PlantContext fetch error:", e);
        setError(e.message || "Failed to load plants");
        return plantsRef.current; // stale on error
      })
      .finally(() => {
        setLoading(false);
        inflight.current = null;
      });

    inflight.current = promise;
    return promise;
  }, []); // stable — no deps needed

  const refresh = useCallback(() => fetchPlants(true), [fetchPlants]);

  return (
    <PlantContext.Provider value={{ plants, loading, error, fetchPlants, refresh }}>
      {children}
    </PlantContext.Provider>
  );
}

export const usePlants = () => useContext(PlantContext);
