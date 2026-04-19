import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { login as apiLogin, getMe, setToken, clearToken } from "./api.js";

const TOKEN_KEY = "sb_token";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);

  // Validate stored token on mount — skip entirely if no token exists
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => { clearToken(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // Only log out if we still have no valid token (avoid clearing a fresh login)
  useEffect(() => {
    const handle = () => {
      if (!localStorage.getItem(TOKEN_KEY)) setUser(null);
    };
    window.addEventListener("auth:logout", handle);
    return () => window.removeEventListener("auth:logout", handle);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await apiLogin(username, password);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
