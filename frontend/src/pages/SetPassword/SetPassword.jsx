import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { setPassword } from "../../api/auth";
import styles from "./SetPassword.module.css";

const REQUIREMENTS = [
  { key: "at_least_12_chars", label: "At least 12 characters",   test: (p) => p.length >= 12 },
  { key: "has_alpha",         label: "At least one letter",       test: (p) => /[a-zA-Z]/.test(p) },
  { key: "has_numeric",       label: "At least one number",       test: (p) => /\d/.test(p) },
  { key: "has_special",       label: "At least one special character", test: (p) => /[^a-zA-Z0-9]/.test(p) },
];

function RequirementList({ password }) {
  return (
    <ul className={styles.reqList}>
      {REQUIREMENTS.map(({ key, label, test }) => (
        <li key={key} className={test(password) ? styles.reqMet : styles.reqUnmet}>
          <span className={styles.reqIcon}>{test(password) ? "✓" : "✗"}</span>
          {label}
        </li>
      ))}
    </ul>
  );
}

export default function SetPassword() {
  const navigate = useNavigate();

  const [password,        setPasswordVal]  = useState("");
  const [confirmPassword, setConfirmVal]   = useState("");
  const [error,           setError]        = useState(null);
  const [loading,         setLoading]      = useState(false);
  const [success,         setSuccess]      = useState(false);

  const allMet    = REQUIREMENTS.every(({ test }) => test(password));
  const mismatch  = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit = allMet && !mismatch && !loading;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await setPassword(password, confirmPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Account activated</h1>
          <p className={styles.successMsg}>
            Your account is now active. Please{" "}
            <Link to="/login" className={styles.link}>log in</Link>{" "}
            with your new password.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Set your password</h1>
        <p className={styles.subtitle}>AK Legislative Liaison</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            New password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPasswordVal(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {password.length > 0 && <RequirementList password={password} />}

          <label className={styles.label}>
            Confirm password
            <input
              className={`${styles.input} ${mismatch ? styles.inputError : ""}`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmVal(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {mismatch && (
            <p className={styles.error}>Passwords do not match.</p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button
            className={styles.submitBtn}
            type="submit"
            disabled={!canSubmit}
          >
            {loading ? "Setting password…" : "Set password"}
          </button>
        </form>
      </div>
    </div>
  );
}
