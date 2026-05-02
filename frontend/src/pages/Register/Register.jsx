import { useState } from "react";
import { Link } from "react-router-dom";
import { requestRegistrationEmail, requestPasswordResetEmail } from "../../api/auth";
import styles from "./Register.module.css";

// State machine values
const STATE = {
  IDLE: "idle",
  LOADING: "loading",
  EMAIL_SENT: "email_sent",
  NOT_FOUND: "not_found",
  DELETED: "deleted",
  ALREADY_ACTIVE: "already_active",
  RESET_SENT: "reset_sent",
  RESET_LOADING: "reset_loading",
};

export default function Register() {
  const [email, setEmail]   = useState("");
  const [state, setState]   = useState(STATE.IDLE);
  const [error, setError]   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setState(STATE.LOADING);
    try {
      const { status } = await requestRegistrationEmail(email);
      setState(status === "email_sent"     ? STATE.EMAIL_SENT
             : status === "already_active" ? STATE.ALREADY_ACTIVE
             : status === "deleted"        ? STATE.DELETED
             :                              STATE.NOT_FOUND);
    } catch (err) {
      setError(err.message);
      setState(STATE.IDLE);
    }
  }

  async function handleRequestReset() {
    setState(STATE.RESET_LOADING);
    setError(null);
    try {
      await requestPasswordResetEmail(email);
      setState(STATE.RESET_SENT);
    } catch (err) {
      setError(err.message);
      setState(STATE.ALREADY_ACTIVE);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Register</h1>
        <p className={styles.subtitle}>AK Legislative Liaison</p>

        {state === STATE.IDLE || state === STATE.LOADING ? (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              Email address
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button
              className={styles.submitBtn}
              type="submit"
              disabled={state === STATE.LOADING}
            >
              {state === STATE.LOADING ? "Checking…" : "Request activation email"}
            </button>
          </form>
        ) : null}

        {state === STATE.EMAIL_SENT && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Check your inbox</p>
            <p className={styles.resultMsg}>
              An activation email has been sent to <strong>{email}</strong>. Please
              check your inbox (and spam folder) and click the link to set your
              password. The link is valid for 30 minutes.
            </p>
          </div>
        )}

        {state === STATE.NOT_FOUND && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Account not found</p>
            <p className={styles.resultMsg}>
              No account exists for <strong>{email}</strong>. If you believe this
              is an error, please contact{" "}
              <a href="mailto:contact@aklegup.com" className={styles.mailLink}>
                contact@aklegup.com
              </a>.
            </p>
            <button
              className={styles.secondaryBtn}
              onClick={() => setState(STATE.IDLE)}
            >
              Try a different email
            </button>
          </div>
        )}

        {state === STATE.DELETED && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Account unavailable</p>
            <p className={styles.resultMsg}>
              The account associated with <strong>{email}</strong> has been deleted.
              Please reach out to{" "}
              <a href="mailto:contact@aklegup.com" className={styles.mailLink}>
                contact@aklegup.com
              </a>{" "}
              if you need assistance.
            </p>
          </div>
        )}

        {(state === STATE.ALREADY_ACTIVE || state === STATE.RESET_LOADING) && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Account already activated</p>
            <p className={styles.resultMsg}>
              <strong>{email}</strong> already has an active account. Would you
              like to reset your password instead?
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <button
              className={styles.submitBtn}
              onClick={handleRequestReset}
              disabled={state === STATE.RESET_LOADING}
            >
              {state === STATE.RESET_LOADING ? "Sending…" : "Request password reset email"}
            </button>
          </div>
        )}

        {state === STATE.RESET_SENT && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Password reset email sent</p>
            <p className={styles.resultMsg}>
              A password reset link has been sent to <strong>{email}</strong>.
              Please check your inbox — the link is valid for 30 minutes.
            </p>
          </div>
        )}

        <div className={styles.footer}>
          Already have an account?{" "}
          <Link to="/login" className={styles.link}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
