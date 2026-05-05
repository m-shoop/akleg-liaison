import { Fragment, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  adminCreateUser,
  adminDeleteUser,
  adminListDeletedUsers,
  adminListUsers,
  adminReviveUser,
  adminUpdateUserName,
} from "../../api/users";
import {
  adminFetchCommPrefsHistory,
  adminUpdateCommPrefs,
} from "../../api/email";
import styles from "./ManageUsers.module.css";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function sortUsers(list) {
  return [...list].sort((a, b) => {
    const an = (a.name ?? "").toLowerCase();
    const bn = (b.name ?? "").toLowerCase();
    if (an && bn) return an.localeCompare(bn);
    if (an) return -1;
    if (bn) return 1;
    return a.email.localeCompare(b.email);
  });
}

function CommPrefsHistory({ history }) {
  if (!history) return <p className={styles.muted}>Loading history…</p>;
  if (history.length === 0) {
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

function DeleteUserModal({ user, busy, error, onCancel, onConfirm }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const matches = text === "DELETE";
  const label = user.name ? `${user.name} (${user.email})` : user.email;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
        <h2 id="delete-user-title" className={styles.modalTitle}>Delete user</h2>
        <p className={styles.modalBody}>
          You are about to delete <strong>{label}</strong>. They will no longer
          be able to log in or appear in dropdowns. They can be revived later
          from the Deleted Users section, but reactivation requires them to
          register a new password.
        </p>
        <p className={styles.modalBody}>
          To confirm, type <code className={styles.codeWord}>DELETE</code> below.
        </p>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerBtnSolid}
            onClick={() => onConfirm(user)}
            disabled={!matches || busy}
          >
            {busy ? "Deleting…" : "DELETE"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  expanded,
  onToggleExpand,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  editing,
  nameDraft,
  onNameDraftChange,
  nameBusy,
  nameError,
  onTogglePrefs,
  prefsBusy,
  prefsHistory,
  onAskDelete,
  showDeleteCol,
}) {
  const optedOut = !user.email_enabled;
  return (
    <Fragment>
      <tr>
        <td className={styles.expandCell}>
          <button
            type="button"
            className={styles.expandBtn}
            onClick={() => onToggleExpand(user.id)}
            aria-label={expanded ? "Collapse details" : "Expand details"}
            aria-expanded={expanded}
          >
            {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td>
          {editing ? (
            <div className={styles.inlineEdit}>
              <input
                type="text"
                className={styles.inlineInput}
                value={nameDraft}
                onChange={(e) => onNameDraftChange(e.target.value)}
                maxLength={255}
                disabled={nameBusy}
                autoFocus
              />
              <button
                type="button"
                className={styles.smallPrimaryBtn}
                onClick={() => onSaveEdit(user.id)}
                disabled={nameBusy}
              >
                {nameBusy ? "…" : "Save"}
              </button>
              <button
                type="button"
                className={styles.smallCancelBtn}
                onClick={onCancelEdit}
                disabled={nameBusy}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className={styles.nameCell}>
              <span>{user.name || <span className={styles.muted}>—</span>}</span>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onStartEdit(user)}
                title="Edit name"
                aria-label="Edit name"
              >
                ✎
              </button>
            </div>
          )}
        </td>
        <td>{user.email}</td>
        <td>
          <span
            className={
              user.user_status === "active"
                ? styles.statusActive
                : user.user_status === "deleted"
                ? styles.statusDeleted
                : styles.statusInactive
            }
          >
            {user.user_status}
          </span>
        </td>
        <td>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={optedOut}
              disabled={prefsBusy || user.user_status === "deleted"}
              onChange={(e) => onTogglePrefs(user, !e.target.checked)}
            />
            <span>{optedOut ? "Opted out" : "Receiving"}</span>
          </label>
        </td>
        {showDeleteCol && (
          <td className={styles.actionCell}>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => onAskDelete(user)}
              disabled={isSelf}
              title={isSelf ? "You can't delete your own account" : "Delete user"}
            >
              Delete
            </button>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={showDeleteCol ? 6 : 5}>
            <div className={styles.detailPanel}>
              <h4 className={styles.detailHeader}>Email-preferences history</h4>
              {nameError && <p className={styles.error}>{nameError}</p>}
              <CommPrefsHistory history={prefsHistory} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default function ManageUsers() {
  const { token, isLoggedIn, can, username } = useAuth();
  const isAdmin = can("user:manage");

  const [users, setUsers] = useState([]);
  const [listError, setListError] = useState(null);
  const [listLoading, setListLoading] = useState(true);

  const [emailDraft, setEmailDraft] = useState("");
  const [createNameDraft, setCreateNameDraft] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createdNotice, setCreatedNotice] = useState(null);

  // Inline name edit
  const [editingId, setEditingId] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState(null);

  // Per-row expansion + comm-prefs history cache
  const [expandedId, setExpandedId] = useState(null);
  const [prefsHistory, setPrefsHistory] = useState({}); // { userId: [...] }
  const [prefsBusyId, setPrefsBusyId] = useState(null);

  // Delete flow
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Deleted users section
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [deletedUsers, setDeletedUsers] = useState([]);
  const [deletedLoaded, setDeletedLoaded] = useState(false);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedError, setDeletedError] = useState(null);
  const [reviveBusyId, setReviveBusyId] = useState(null);

  useEffect(() => {
    if (!isAdmin || !token) return;
    setListLoading(true);
    adminListUsers(token)
      .then((u) => setUsers(sortUsers(u)))
      .catch((err) => setListError(err.message))
      .finally(() => setListLoading(false));
  }, [isAdmin, token]);

  async function refreshHistoryFor(userEmail, userId) {
    try {
      const h = await adminFetchCommPrefsHistory(userEmail, token);
      setPrefsHistory((prev) => ({ ...prev, [userId]: h }));
    } catch (err) {
      setPrefsHistory((prev) => ({ ...prev, [userId]: [] }));
      setNameError(err.message);
    }
  }

  function handleToggleExpand(userId) {
    if (expandedId === userId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(userId);
    if (prefsHistory[userId] === undefined) {
      const u = users.find((x) => x.id === userId);
      if (u) refreshHistoryFor(u.email, userId);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const email = emailDraft.trim().toLowerCase();
    const name = createNameDraft.trim();
    if (!email || !name) {
      setCreateError("Email and name are both required.");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    setCreatedNotice(null);
    try {
      const newUser = await adminCreateUser(email, name, token);
      setUsers((prev) => sortUsers([...prev, newUser]));
      setEmailDraft("");
      setCreateNameDraft("");
      setCreatedNotice(
        `Created ${newUser.name || newUser.email}. They'll need to register to set their password.`,
      );
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateBusy(false);
    }
  }

  function handleStartEdit(user) {
    setEditingId(user.id);
    setNameDraft(user.name ?? "");
    setNameError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setNameDraft("");
    setNameError(null);
  }

  async function handleSaveEdit(userId) {
    setNameBusy(true);
    setNameError(null);
    try {
      const updated = await adminUpdateUserName(
        userId,
        nameDraft.trim() || null,
        token,
      );
      setUsers((prev) =>
        sortUsers(prev.map((u) => (u.id === updated.id ? updated : u))),
      );
      setEditingId(null);
      setNameDraft("");
    } catch (err) {
      setNameError(err.message);
    } finally {
      setNameBusy(false);
    }
  }

  async function handleTogglePrefs(user, newEnabled) {
    setPrefsBusyId(user.id);
    setNameError(null);
    try {
      const updatedPrefs = await adminUpdateCommPrefs(
        user.email,
        newEnabled,
        token,
      );
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id ? { ...u, email_enabled: updatedPrefs.email_enabled } : u,
        ),
      );
      // Refresh history if expanded
      if (expandedId === user.id) {
        refreshHistoryFor(user.email, user.id);
      } else {
        setPrefsHistory((prev) => {
          const next = { ...prev };
          delete next[user.id];
          return next;
        });
      }
    } catch (err) {
      setNameError(err.message);
    } finally {
      setPrefsBusyId(null);
    }
  }

  function handleAskDelete(user) {
    setDeleteTarget(user);
    setDeleteError(null);
  }

  async function handleConfirmDelete(user) {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await adminDeleteUser(user.id, token);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setDeleteTarget(null);
      // Invalidate the deleted-users cache so it refetches next open
      setDeletedLoaded(false);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function loadDeletedUsers() {
    setDeletedLoading(true);
    setDeletedError(null);
    try {
      const list = await adminListDeletedUsers(token);
      setDeletedUsers(sortUsers(list));
      setDeletedLoaded(true);
    } catch (err) {
      setDeletedError(err.message);
    } finally {
      setDeletedLoading(false);
    }
  }

  function handleToggleDeleted() {
    const next = !deletedOpen;
    setDeletedOpen(next);
    if (next && !deletedLoaded) loadDeletedUsers();
  }

  async function handleRevive(user) {
    if (!window.confirm(`Revive ${user.name || user.email}? Their account will return as inactive and they'll need to register again to set a password.`)) {
      return;
    }
    setReviveBusyId(user.id);
    setDeletedError(null);
    try {
      const revived = await adminReviveUser(user.id, token);
      setDeletedUsers((prev) => prev.filter((u) => u.id !== user.id));
      setUsers((prev) => sortUsers([...prev, revived]));
    } catch (err) {
      setDeletedError(err.message);
    } finally {
      setReviveBusyId(null);
    }
  }

  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Manage Users</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Add a new user</h2>
        <p className={styles.muted}>
          The user is created as <strong>inactive</strong>. They must register
          from the login page to set their password and activate the account.
        </p>
        <form className={styles.form} onSubmit={handleCreate}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="new-user-email">Email</label>
            <input
              id="new-user-email"
              type="email"
              className={styles.input}
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              maxLength={255}
              required
              autoComplete="off"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="new-user-name">Name</label>
            <input
              id="new-user-name"
              type="text"
              className={styles.input}
              value={createNameDraft}
              onChange={(e) => setCreateNameDraft(e.target.value)}
              maxLength={255}
              required
            />
          </div>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={createBusy}
          >
            {createBusy ? "Creating…" : "Create user"}
          </button>
        </form>
        {createError && <p className={styles.error}>{createError}</p>}
        {createdNotice && <p className={styles.success}>{createdNotice}</p>}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Active &amp; inactive users</h2>
        {listLoading && <p className={styles.muted}>Loading…</p>}
        {listError && <p className={styles.error}>{listError}</p>}
        {!listLoading && !listError && users.length === 0 && (
          <p className={styles.muted}>No users found.</p>
        )}
        {users.length > 0 && (
          <table className={styles.userTable}>
            <thead>
              <tr>
                <th aria-label="Expand" />
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Email notifications</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={u.email === username}
                  expanded={expandedId === u.id}
                  onToggleExpand={handleToggleExpand}
                  onStartEdit={handleStartEdit}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  editing={editingId === u.id}
                  nameDraft={nameDraft}
                  onNameDraftChange={setNameDraft}
                  nameBusy={nameBusy && editingId === u.id}
                  nameError={expandedId === u.id ? nameError : null}
                  onTogglePrefs={handleTogglePrefs}
                  prefsBusy={prefsBusyId === u.id}
                  prefsHistory={prefsHistory[u.id]}
                  onAskDelete={handleAskDelete}
                  showDeleteCol
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <button
          type="button"
          className={styles.collapseHeader}
          onClick={handleToggleDeleted}
          aria-expanded={deletedOpen}
        >
          <span className={styles.collapseChevron}>{deletedOpen ? "▾" : "▸"}</span>
          <span>Deleted users {deletedLoaded && deletedUsers.length > 0 && `(${deletedUsers.length})`}</span>
        </button>
        {deletedOpen && (
          <div className={styles.collapseBody}>
            {deletedLoading && <p className={styles.muted}>Loading…</p>}
            {deletedError && <p className={styles.error}>{deletedError}</p>}
            {deletedLoaded && !deletedLoading && deletedUsers.length === 0 && (
              <p className={styles.muted}>No deleted users.</p>
            )}
            {deletedUsers.length > 0 && (
              <table className={styles.userTable}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {deletedUsers.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name || <span className={styles.muted}>—</span>}</td>
                      <td>{u.email}</td>
                      <td className={styles.actionCell}>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          onClick={() => handleRevive(u)}
                          disabled={reviveBusyId === u.id}
                        >
                          {reviveBusyId === u.id ? "Reviving…" : "Revive"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {deleteTarget && (
        <DeleteUserModal
          user={deleteTarget}
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
