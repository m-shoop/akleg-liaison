import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  checkForgotPassword,
  requestPasswordResetEmail,
  requestRegistrationEmail,
} from "../../api/auth";
import styles from "./ForgotPassword.module.css";

const STATE = {
  IDLE: "idle",
  CHECKING: "checking",
  NOT_FOUND: "not_found",
  DELETED: "deleted",
  INACTIVE: "inactive",
  ACTIVE: "active",          // show "Request reset email" button
  REQUESTING: "requesting",
  EMAIL_SENT: "email_sent",
  REG_REQUESTING: "reg_requesting",
  REG_SENT: "reg_sent",
};

export default function ForgotPassword() {
  const location = useLocation();
  // Pre-fill email if the user came from the login page
  const [email, setEmail]   = useState(location.state?.email ?? "");
  const [state, setState]   = useState(STATE.IDLE);
  const [error, setError]   = useState(null);

  async function handleCheck(e) {
    e.preventDefault();
    setError(null);
    setState(STATE.CHECKING);
    try {
      const { status } = await checkForgotPassword(email);
      setState(
        status === "active"   ? STATE.ACTIVE
        : status === "inactive" ? STATE.INACTIVE
        : status === "deleted"  ? STATE.DELETED
        :                        STATE.NOT_FOUND
      );
    } catch (err) {
      setError(err.message);
      setState(STATE.IDLE);
    }
  }

  async function handleRequestReset() {
    setState(STATE.REQUESTING);
    setError(null);
    try {
      await requestPasswordResetEmail(email);
      setState(STATE.EMAIL_SENT);
    } catch (err) {
      setError(err.message);
      setState(STATE.ACTIVE);
    }
  }

  async function handleRequestRegistration() {
    setState(STATE.REG_REQUESTING);
    setError(null);
    try {
      await requestRegistrationEmail(email);
      setState(STATE.REG_SENT);
    } catch (err) {
      setError(err.message);
      setState(STATE.INACTIVE);
    }
  }

  const showForm = state === STATE.IDLE || state === STATE.CHECKING;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Forgot password?</h1>
        <p className={styles.subtitle}>AK Legislative Liaison</p>

        {showForm && (
          <form className={styles.form} onSubmit={handleCheck}>
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
              disabled={state === STATE.CHECKING}
            >
              {state === STATE.CHECKING ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {state === STATE.NOT_FOUND && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Account not found</p>
            <p className={styles.resultMsg}>
              No account exists for <strong>{email}</strong>.
            </p>
            <button className={styles.secondaryBtn} onClick={() => setState(STATE.IDLE)}>
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
              </a>.
            </p>
          </div>
        )}

        {(state === STATE.INACTIVE || state === STATE.REG_REQUESTING) && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Account not yet activated</p>
            <p className={styles.resultMsg}>
              <strong>{email}</strong> exists but has not been activated yet.
              Would you like to receive a new activation email?
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <button
              className={styles.submitBtn}
              onClick={handleRequestRegistration}
              disabled={state === STATE.REG_REQUESTING}
            >
              {state === STATE.REG_REQUESTING ? "Sending…" : "Request activation email"}
            </button>
          </div>
        )}

        {state === STATE.REG_SENT && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Activation email sent</p>
            <p className={styles.resultMsg}>
              An activation link has been sent to <strong>{email}</strong>.
              Please check your inbox — the link is valid for 30 minutes.
            </p>
          </div>
        )}

        {(state === STATE.ACTIVE || state === STATE.REQUESTING) && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Account found</p>
            <p className={styles.resultMsg}>
              Click below to send a password reset link to <strong>{email}</strong>.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <button
              className={styles.submitBtn}
              onClick={handleRequestReset}
              disabled={state === STATE.REQUESTING}
            >
              {state === STATE.REQUESTING ? "Sending…" : "Request reset password email"}
            </button>
          </div>
        )}

        {state === STATE.EMAIL_SENT && (
          <div className={styles.resultBox}>
            <p className={styles.resultTitle}>Check your inbox</p>
            <p className={styles.resultMsg}>
              A password reset link has been sent to <strong>{email}</strong>.
              The link is valid for 30 minutes.
            </p>
          </div>
        )}

        <div className={styles.footer}>
          <Link to="/login" className={styles.link}>Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
