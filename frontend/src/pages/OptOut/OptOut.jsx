import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { applyOptOut, checkOptOutToken } from "../../api/email";
import styles from "./OptOut.module.css";

export default function OptOut() {
  const { token } = useParams();
  const [status, setStatus] = useState("checking");
  const [email, setEmail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // GET-on-mount checks the token without applying it. POST is what actually
  // mutates state — protects against email-client URL prefetching.
  useEffect(() => {
    if (!token) return;
    checkOptOutToken(token)
      .then((res) => {
        if (res.ok) {
          setEmail(res.email);
          setStatus("ready");
        } else {
          setError(res.detail || "Invalid token.");
          setStatus("invalid");
        }
      })
      .catch((err) => {
        setError(err.message);
        setStatus("invalid");
      });
  }, [token]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await applyOptOut(token);
      setStatus("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Opt out of emails</h1>

        {status === "checking" && (
          <p className={styles.muted}>Checking your opt-out link…</p>
        )}

        {status === "invalid" && (
          <>
            <p className={styles.error}>
              {error ?? "This link is invalid or has expired."}
            </p>
            <p className={styles.muted}>
              You can also opt out from your account settings page.
            </p>
          </>
        )}

        {status === "ready" && (
          <>
            <p>
              Click the button below to opt out of emails for{" "}
              <strong>{email}</strong>.
            </p>
            <p className={styles.muted}>
              You'll stop receiving hearing-assignment emails from Leg Up. You
              can opt back in anytime from your account settings.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleConfirm}
              disabled={busy}
            >
              {busy ? "Opting out…" : "Confirm opt out"}
            </button>
          </>
        )}

        {status === "done" && (
          <>
            <p>
              You've been opted out. We won't send hearing-assignment emails
              to <strong>{email}</strong>.
            </p>
            <p className={styles.muted}>
              You can opt back in anytime from your account settings.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
