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
import { adminListUsers, adminUpdateUserName } from "../../api/users";
import UserSelect from "../../components/UserSelect/UserSelect";
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

  // Admin: edit display names
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [nameSavedAt, setNameSavedAt] = useState(null);

  useEffect(() => {
    if (!isLoggedIn || !token) return;
    Promise.all([fetchMyCommPrefs(token), fetchMyCommPrefsHistory(token)])
      .then(([p, h]) => {
        setMyPrefs(p);
        setMyHistory(h);
      })
      .catch((err) => setError(err.message));
  }, [isLoggedIn, token]);

  useEffect(() => {
    if (!isAdmin || !token) return;
    adminListUsers(token)
      .then((users) => setAllUsers(users))
      .catch((err) => setNameError(err.message));
  }, [isAdmin, token]);

  useEffect(() => {
    const u = allUsers.find((x) => String(x.id) === String(selectedUserId));
    setNameDraft(u?.name ?? "");
    setNameSavedAt(null);
    setNameError(null);
  }, [selectedUserId, allUsers]);

  async function handleSaveName() {
    if (!selectedUserId) return;
    setNameBusy(true);
    setNameError(null);
    setNameSavedAt(null);
    try {
      const updated = await adminUpdateUserName(
        selectedUserId,
        nameDraft.trim() || null,
        token,
      );
      setAllUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setNameSavedAt(new Date());
    } catch (err) {
      setNameError(err.message);
    } finally {
      setNameBusy(false);
    }
  }

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

  useEffect(() => {
    if (!adminEmail) {
      setAdminPrefs(null);
      setAdminHistory([]);
      setAdminError(null);
      return;
    }
    let cancelled = false;
    setAdminError(null);
    setAdminBusy(true);
    setAdminPrefs(null);
    setAdminHistory([]);
    Promise.all([
      adminFetchCommPrefs(adminEmail, token),
      adminFetchCommPrefsHistory(adminEmail, token),
    ])
      .then(([p, h]) => {
        if (cancelled) return;
        setAdminPrefs(p);
        setAdminHistory(h);
      })
      .catch((err) => {
        if (!cancelled) setAdminError(err.message);
      })
      .finally(() => {
        if (!cancelled) setAdminBusy(false);
      });
    return () => { cancelled = true; };
  }, [adminEmail, token]);

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
          <div className={styles.nameEditRow}>
            <UserSelect
              users={allUsers}
              value={adminEmail}
              onChange={setAdminEmail}
              className={styles.userSelect}
              disabled={adminBusy}
            />
          </div>
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

      {isAdmin && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Admin: edit user display name</h2>
          <p className={styles.muted}>
            The display name appears on assignment dropdowns and tables. Email
            remains the unique identifier.
          </p>
          <div className={styles.nameEditRow}>
            <select
              className={styles.userSelect}
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">— Select a user —</option>
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} (${u.email})` : u.email}
                </option>
              ))}
            </select>
          </div>
          {selectedUserId && (
            <div className={styles.nameEditRow}>
              <input
                type="text"
                className={styles.input}
                placeholder="Full name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={255}
              />
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={nameBusy}
                onClick={handleSaveName}
              >
                {nameBusy ? "Saving…" : "Save name"}
              </button>
            </div>
          )}
          {nameError && <p className={styles.error}>{nameError}</p>}
          {nameSavedAt && (
            <p className={styles.success}>Saved at {nameSavedAt.toLocaleTimeString()}</p>
          )}
        </section>
      )}
    </div>
  );
}
