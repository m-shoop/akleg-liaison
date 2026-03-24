import { useEffect, useState } from "react";
import styles from "./Toast.module.css";

/**
 * Displays a brief notification message.
 *
 * Props:
 *   message  — text to display (pass null/empty to hide)
 *   type     — "success" | "error" | "info" (default "success")
 *   duration — ms before auto-dismiss for success/info toasts (default 4000)
 *              error toasts never auto-dismiss
 *   onDismiss — called when the toast closes (auto or manual)
 */
export default function Toast({ message, type = "success", duration = 4000, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (type !== "error") {
      const t = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, duration);
      return () => clearTimeout(t);
    }
  }, [message, type, duration, onDismiss]);

  if (!visible || !message) return null;

  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <span className={styles.message}>{message}</span>
      <button className={styles.close} onClick={() => { setVisible(false); onDismiss?.(); }}>
        ✕
      </button>
    </div>
  );
}
