import { useEffect, useRef, useState } from "react";
import { loginRequest } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import styles from "./ReauthModal.module.css";

export default function ReauthModal() {
  const { username, login } = useAuth();
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    function handleRequired() {
      setVisible(true);
      setPassword("");
      setError(null);
      // Focus the password field after the modal renders
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener("reauth-required", handleRequired);
    return () => window.removeEventListener("reauth-required", handleRequired);
  }, []);

  function dismiss() {
    setVisible(false);
    window.dispatchEvent(new CustomEvent("reauth-complete", { detail: { token: null } }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await loginRequest(username, password);
      login(data.access_token, username, data.role);
      setVisible(false);
      setPassword("");
      window.dispatchEvent(new CustomEvent("reauth-complete", { detail: { token: data.access_token } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <h2 id="reauth-title" className={styles.title}>Session Expired</h2>
        <p className={styles.subtitle}>
          Your session has expired. Re-enter your password to continue as <strong>{username}</strong>.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Password
            <input
              ref={inputRef}
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.submitBtn} disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={dismiss} disabled={busy}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
