import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import styles from "./SessionExpiredBanner.module.css";

export default function SessionExpiredBanner() {
  const { isLoggedIn, isTokenExpired } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTokenExpired) setDismissed(false);
  }, [isTokenExpired]);

  if (!isLoggedIn || !isTokenExpired || dismissed) return null;

  function handleReauth() {
    window.dispatchEvent(new Event("reauth-required"));
  }

  return (
    <div className={styles.banner} role="alert">
      <span className={styles.message}>
        Your session has expired — some content may be hidden.
      </span>
      <button className={styles.reauthBtn} onClick={handleReauth}>
        Log in again
      </button>
      <button
        className={styles.dismissBtn}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
