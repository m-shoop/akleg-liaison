import { createContext, useContext, useState, useEffect, useRef } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "akleg_token";
const USER_KEY  = "akleg_user";
const ROLE_KEY  = "akleg_role";

function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function checkExpired(token) {
  if (!token) return false;
  const expiry = getTokenExpiry(token);
  return expiry !== null && Date.now() >= expiry;
}

export function AuthProvider({ children }) {
  const [token, setToken]   = useState(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY));
  const [role, setRole] = useState(() => localStorage.getItem(ROLE_KEY));
  const [isTokenExpired, setIsTokenExpired] = useState(
    () => checkExpired(localStorage.getItem(TOKEN_KEY))
  );
  const expiryTimer = useRef(null);

  useEffect(() => {
    clearTimeout(expiryTimer.current);
    if (!token) {
      setIsTokenExpired(false);
      return;
    }
    const expiry = getTokenExpiry(token);
    if (expiry === null) return;
    const msUntilExpiry = expiry - Date.now();
    if (msUntilExpiry <= 0) {
      setIsTokenExpired(true);
      return;
    }
    setIsTokenExpired(false);
    expiryTimer.current = setTimeout(() => setIsTokenExpired(true), msUntilExpiry);
    return () => clearTimeout(expiryTimer.current);
  }, [token]);

  function login(accessToken, user, userRole) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(USER_KEY, user);
    localStorage.setItem(ROLE_KEY, userRole);
    setToken(accessToken);
    setUsername(user);
    setRole(userRole);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
    setToken(null);
    setUsername(null);
    setRole(null);
  }

  return (
    <AuthContext.Provider value={{ token, username, role, isLoggedIn: !!token, isEditor: role === "admin", isTokenExpired, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
