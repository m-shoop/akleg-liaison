import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "akleg_token";
const USER_KEY  = "akleg_user";
const ROLE_KEY  = "akleg_role";

export function AuthProvider({ children }) {
  const [token, setToken]   = useState(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY));
  const [role, setRole] = useState(() => localStorage.getItem(ROLE_KEY));

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
    <AuthContext.Provider value={{ token, username, role, isLoggedIn: !!token, isEditor: role === "admin", login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
