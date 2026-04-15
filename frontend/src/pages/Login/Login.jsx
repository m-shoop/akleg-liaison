import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { loginRequest } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import styles from "./Login.module.css";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  // Show a banner when redirected here after a token expiry from an email link
  const tokenExpiredType = searchParams.get("tokenExpired"); // "registration" | "password_reset"

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { access_token, permissions } = await loginRequest(email, password);
      login(access_token, email.toLowerCase(), permissions);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>AK Legislative Liaison</p>

        {tokenExpiredType && (
          <div className={styles.tokenExpiredBanner} role="alert">
            {tokenExpiredType === "registration"
              ? "Your account activation link has expired."
              : "Your password reset link has expired."}{" "}
            Please request a new one below.
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className={styles.links}>
          <Link
            to="/forgot-password"
            state={{ email }}
            className={styles.link}
          >
            Forgot password?
          </Link>
          <Link to="/register" className={styles.link}>
            Register
          </Link>
        </div>
      </div>
    </div>
  );
}
