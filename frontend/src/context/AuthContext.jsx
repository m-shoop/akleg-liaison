import { createContext, useCallback, useContext, useState } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY       = "akleg_token";
const USER_KEY        = "akleg_user";
const PERMISSIONS_KEY = "akleg_permissions";

function loadPermissions() {
  try {
    return JSON.parse(localStorage.getItem(PERMISSIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function AuthProvider({ children }) {
  const [token,       setToken]       = useState(() => localStorage.getItem(TOKEN_KEY));
  const [username,    setUsername]    = useState(() => localStorage.getItem(USER_KEY));
  const [permissions, setPermissions] = useState(loadPermissions);

  const can = useCallback(
    (permission) => permissions.includes(permission),
    [permissions]
  );

  function login(accessToken, user, userPermissions) {
    localStorage.setItem(TOKEN_KEY,       accessToken);
    localStorage.setItem(USER_KEY,        user);
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(userPermissions));
    setToken(accessToken);
    setUsername(user);
    setPermissions(userPermissions);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PERMISSIONS_KEY);
    setToken(null);
    setUsername(null);
    setPermissions([]);
  }

  return (
    <AuthContext.Provider value={{ token, username, isLoggedIn: !!token, can, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
