import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  adminFetchCommPrefs,
  adminFetchCommPrefsHistory,
  adminUpdateCommPrefs,
  fetchMyCommPrefs,
  fetchMyCommPrefsHistory,
  updateMyCommPrefs,
} from "../../api/email";
import styles from "./Settings.module.css";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function HistoryTable({ history }) {
  if (!history || history.length === 0) {
    return <p className={styles.muted}>No changes recorded.</p>;
  }
  return (
    <table className={styles.historyTable}>
      <thead>
        <tr>
          <th>When</th>
          <th>Field</th>
          <th>Old → New</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {history.map((h) => (
          <tr key={h.id}>
            <td>{fmtDateTime(h.changed_at)}</td>
            <td>{h.field}</td>
            <td>
              {String(h.old_value ?? "—")} → {String(h.new_value)}
            </td>
            <td>{h.source ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeHistory({ history }) {
  return (
    <details className={styles.historyDetails}>
      <summary className={styles.historySummary}>
        Change history
        {history?.length > 0 && (
          <span className={styles.historyCount}>({history.length})</span>
        )}
      </summary>
      <div className={styles.historyBody}>
        <HistoryTable history={history} />
      </div>
    </details>
  );
}

function CommPrefsSection({ prefs, onToggle, busy }) {
  if (!prefs) return null;
  return (
    <div className={styles.commPrefsRow}>
      <div>
        <div className={styles.label}>Email notifications</div>
        <div className={styles.muted}>
          When off, you won't receive hearing-assignment emails.
        </div>
      </div>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={!prefs.email_enabled}
          disabled={busy}
          onChange={(e) => onToggle(!e.target.checked)}
        />
        <span>Opt out</span>
      </label>
    </div>
  );
}

export default function Settings() {
  const { token, isLoggedIn, can } = useAuth();
  const isAdmin = can("comm-prefs:admin");

  // Self
  const [myPrefs, setMyPrefs] = useState(null);
  const [myHistory, setMyHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Admin lookup
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPrefs, setAdminPrefs] = useState(null);
  const [adminHistory, setAdminHistory] = useState([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState(null);

  useEffect(() => {
    if (!isLoggedIn || !token) return;
    Promise.all([fetchMyCommPrefs(token), fetchMyCommPrefsHistory(token)])
      .then(([p, h]) => {
        setMyPrefs(p);
        setMyHistory(h);
      })
      .catch((err) => setError(err.message));
  }, [isLoggedIn, token]);

  async function handleToggle(newEnabled) {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMyCommPrefs(newEnabled, token);
      setMyPrefs(updated);
      const h = await fetchMyCommPrefsHistory(token);
      setMyHistory(h);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminLookup(e) {
    e.preventDefault();
    setAdminError(null);
    setAdminBusy(true);
    setAdminPrefs(null);
    setAdminHistory([]);
    try {
      const email = adminEmail.trim();
      if (!email) throw new Error("Enter an email address");
      const [p, h] = await Promise.all([
        adminFetchCommPrefs(email, token),
        adminFetchCommPrefsHistory(email, token),
      ]);
      setAdminPrefs(p);
      setAdminHistory(h);
    } catch (err) {
      setAdminError(err.message);
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleAdminToggle(newEnabled) {
    if (!adminPrefs) return;
    setAdminBusy(true);
    setAdminError(null);
    try {
      const updated = await adminUpdateCommPrefs(
        adminPrefs.email,
        newEnabled,
        token,
      );
      setAdminPrefs(updated);
      const h = await adminFetchCommPrefsHistory(adminPrefs.email, token);
      setAdminHistory(h);
    } catch (err) {
      setAdminError(err.message);
    } finally {
      setAdminBusy(false);
    }
  }

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>My communication preferences</h2>
        {myPrefs && (
          <p className={styles.subjectLine}>
            Showing preferences for <strong>{myPrefs.email}</strong>
          </p>
        )}
        <CommPrefsSection prefs={myPrefs} onToggle={handleToggle} busy={busy} />
        {error && <p className={styles.error}>{error}</p>}
        <ChangeHistory history={myHistory} />
      </section>

      {isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Admin: view another user's preferences</h2>
          <form onSubmit={handleAdminLookup} className={styles.adminLookup}>
            <input
              type="email"
              className={styles.input}
              placeholder="email@example.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={adminBusy || !adminEmail.trim()}
            >
              Look up
            </button>
          </form>
          {adminError && <p className={styles.error}>{adminError}</p>}
          {adminPrefs && (
            <>
              <p className={styles.subjectLine}>
                Showing preferences for <strong>{adminPrefs.email}</strong>
              </p>
              <CommPrefsSection
                prefs={adminPrefs}
                onToggle={handleAdminToggle}
                busy={adminBusy}
              />
              <ChangeHistory history={adminHistory} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
