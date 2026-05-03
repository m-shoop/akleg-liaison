import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSavedReport,
  fetchRoles,
  fetchSavedReports,
  reorderSavedReport,
  setDefaultUserReport,
  sortSavedReportsAlphabetically,
  updateSavedReport,
} from "../api/savedReports";
import { resolveCriteriaSentinels } from "../utils/criteriaSentinels";
import { migrateLegacyCriteria } from "../utils/criteriaMigration";

/**
 * State + handlers for the saved-reports feature on a page that uses StackingCriteria.
 *
 * The hook owns: the list of visible reports for the registry, which one is "loaded"
 * (so the Save button can target it), the loaded snapshot (so we can detect dirty
 * relative to it), the Include Inactive flag, and — when the caller has system-report:edit
 * — the list of roles available for the system-level Save As path.
 *
 * The page owns: current criteria value, the function that loads criteria + runs the
 * query (passed in as `onLoad`).
 */
export function useSavedReports({
  registryName,
  currentCriteria,
  onLoad,
  token,
  skipDefaultLoad = false,
  canSystemEdit = false,
  username = null,
}) {
  const [reports, setReports] = useState([]);
  const [defaultReportId, setDefaultReportId] = useState(null);
  const [loadedReport, setLoadedReport] = useState(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [error, setError] = useState(null);
  const initialLoadDone = useRef(false);

  const onLoadRef = useRef(onLoad);
  useEffect(() => { onLoadRef.current = onLoad; }, [onLoad]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchSavedReports({ registryName, includeInactive, token });
      setReports(data.reports);
      setDefaultReportId(data.default_report_id);
      setError(null);
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, [registryName, includeInactive, token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await refresh();
      if (cancelled || !data) return;
      if (!initialLoadDone.current && !skipDefaultLoad && data.default_report_id != null) {
        const def = data.reports.find((r) => r.id === data.default_report_id);
        if (def && def.is_active) {
          const resolved = resolveCriteriaSentinels(migrateLegacyCriteria(def.report_criteria), { username });
          setLoadedReport(def);
          setLoadedSnapshot(resolved);
          onLoadRef.current?.(resolved);
        }
      }
      initialLoadDone.current = true;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // Whenever the reports list refreshes, keep the loaded report in sync with the
  // server's view (e.g. is_active changes after a toggle, or the row was deleted).
  useEffect(() => {
    if (loadedReport == null) return;
    const fresh = reports.find((r) => r.id === loadedReport.id);
    if (fresh && fresh !== loadedReport) {
      setLoadedReport(fresh);
    }
  }, [reports, loadedReport]);

  // Fetch the role catalog once for users who can create system-level reports.
  useEffect(() => {
    if (!canSystemEdit || !token) return;
    let cancelled = false;
    fetchRoles(token)
      .then((roles) => { if (!cancelled) setAvailableRoles(roles); })
      .catch(() => { /* silent — Save As works without it for user-level only */ });
    return () => { cancelled = true; };
  }, [canSystemEdit, token]);

  const dirty = useMemo(() => {
    if (loadedReport == null || loadedSnapshot == null) return false;
    return JSON.stringify(currentCriteria) !== JSON.stringify(loadedSnapshot);
  }, [loadedReport, loadedSnapshot, currentCriteria]);

  const selectReport = useCallback((id, { force = false } = {}) => {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    if (!force && editMode && dirty && !window.confirm(
      "You have unsaved changes to the current report. Loading another report will discard them. Continue?"
    )) {
      return;
    }
    const resolved = resolveCriteriaSentinels(migrateLegacyCriteria(report.report_criteria), { username });
    setLoadedReport(report);
    setLoadedSnapshot(resolved);
    setEditMode(false);
    onLoadRef.current?.(resolved);
  }, [reports, editMode, dirty, username]);

  /**
   * Select a system-level report by display_name without prompting for unsaved
   * changes — used by the page's "Default Page Settings" reset flow.
   * Returns true if a matching active report was loaded, false otherwise.
   */
  const selectSystemReportByName = useCallback((displayName) => {
    const report = reports.find(
      (r) => r.publication_level === "system" && r.display_name === displayName,
    );
    if (!report || !report.is_active) return false;
    const resolved = resolveCriteriaSentinels(migrateLegacyCriteria(report.report_criteria), { username });
    setLoadedReport(report);
    setLoadedSnapshot(resolved);
    setEditMode(false);
    onLoadRef.current?.(resolved);
    return true;
  }, [reports, username]);

  const clearLoadedReport = useCallback(() => {
    setLoadedReport(null);
    setLoadedSnapshot(null);
    setEditMode(false);
  }, []);

  const startEdit = useCallback(() => {
    if (loadedReport == null) return;
    setEditMode(true);
  }, [loadedReport]);

  const cancelEdit = useCallback(() => {
    if (!editMode) return;
    if (dirty && !window.confirm(
      "Discard your unsaved changes to this report?"
    )) {
      return;
    }
    if (loadedSnapshot) {
      onLoadRef.current?.(loadedSnapshot);
    }
    setEditMode(false);
  }, [editMode, dirty, loadedSnapshot]);

  const newReport = useCallback(() => {
    if (editMode && dirty) {
      const name = loadedReport?.display_name ?? "this report";
      if (!window.confirm(
        `You have unsaved changes to "${name}". Starting a new report keeps your current criteria but disconnects them from the saved report — Save will no longer overwrite "${name}". Continue?`
      )) {
        return;
      }
    }
    setLoadedReport(null);
    setLoadedSnapshot(null);
    setEditMode(false);
  }, [editMode, dirty, loadedReport]);

  const save = useCallback(async () => {
    if (loadedReport == null) return;
    try {
      const updated = await updateSavedReport({
        id: loadedReport.id,
        fields: { report_criteria: currentCriteria },
        token,
      });
      const resolved = resolveCriteriaSentinels(migrateLegacyCriteria(updated.report_criteria), { username });
      setLoadedReport(updated);
      setLoadedSnapshot(resolved);
      setEditMode(false);
      onLoadRef.current?.(resolved);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [loadedReport, currentCriteria, token, refresh, username]);

  const saveAs = useCallback(async (displayName, opts = {}) => {
    const { publicationLevel = "user", allowedRoles = [] } = opts;
    try {
      const created = await createSavedReport({
        displayName,
        registryName,
        publicationLevel,
        allowedRoles,
        reportCriteria: currentCriteria,
        token,
      });
      const resolved = resolveCriteriaSentinels(migrateLegacyCriteria(created.report_criteria), { username });
      setLoadedReport(created);
      setLoadedSnapshot(resolved);
      setEditMode(false);
      setSaveAsOpen(false);
      onLoadRef.current?.(resolved);
      await refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [registryName, currentCriteria, token, refresh, username]);

  /**
   * Update the loaded report's metadata (name, and allowed_roles for system
   * rows).  Distinct from `save`, which persists criteria changes — this one
   * targets settings only and leaves edit mode alone, since renaming or
   * adjusting roles is orthogonal to the criteria-edit flow.
   */
  const editSettings = useCallback(async (displayName, allowedRoles) => {
    if (loadedReport == null) return { ok: false, error: "No report loaded" };
    try {
      const fields = { display_name: displayName };
      if (allowedRoles !== undefined) fields.allowed_roles = allowedRoles;
      const updated = await updateSavedReport({
        id: loadedReport.id,
        fields,
        token,
      });
      setLoadedReport(updated);
      setSettingsOpen(false);
      await refresh();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [loadedReport, token, refresh]);

  const toggleActive = useCallback(async () => {
    if (loadedReport == null) return;
    try {
      const updated = await updateSavedReport({
        id: loadedReport.id,
        fields: { is_active: !loadedReport.is_active },
        token,
      });
      setLoadedReport(updated);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [loadedReport, token, refresh]);

  const isLoadedDefault = loadedReport != null && loadedReport.id === defaultReportId;

  const toggleDefault = useCallback(async () => {
    if (loadedReport == null) return;
    try {
      await setDefaultUserReport({
        registryName,
        reportId: isLoadedDefault ? null : loadedReport.id,
        token,
      });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [loadedReport, isLoadedDefault, registryName, token, refresh]);

  const reorderReport = useCallback(
    async ({ reportId, afterId, beforeId, optimisticReports }) => {
      // Optimistically reorder locally so the dropped pill snaps to its new
      // slot before the server round-trip; refresh() reconciles below.
      if (optimisticReports) setReports(optimisticReports);
      try {
        await reorderSavedReport({
          registryName,
          reportId,
          afterId,
          beforeId,
          token,
        });
        await refresh();
      } catch (e) {
        setError(e.message);
        await refresh();
      }
    },
    [registryName, token, refresh],
  );

  const sortAlphabetical = useCallback(async () => {
    try {
      await sortSavedReportsAlphabetically({ registryName, token });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [registryName, token, refresh]);

  const isLoadedActive = loadedReport?.is_active ?? true;
  const editLocked = loadedReport != null && !editMode;
  const isLoggedIn = !!token;
  const canSave = isLoggedIn && editMode && dirty && isLoadedActive;
  const canSaveAs = isLoggedIn && (currentCriteria?.criteria?.length ?? 0) > 0;
  const canRunQuery = isLoadedActive;

  return {
    reports,
    defaultReportId,
    loadedReport,
    loadedReportId: loadedReport?.id ?? null,
    loadedReportName: loadedReport?.display_name ?? null,
    isLoadedActive,
    isLoadedDefault,
    editMode,
    editLocked,
    loadedDirty: dirty,
    includeInactive,
    setIncludeInactive,
    error,
    availableRoles,
    canSystemEdit: isLoggedIn && canSystemEdit,
    selectReport,
    selectSystemReportByName,
    clearLoadedReport,
    startEdit: isLoggedIn ? startEdit : undefined,
    cancelEdit: isLoggedIn ? cancelEdit : undefined,
    newReport: isLoggedIn ? newReport : undefined,
    canSave,
    save: isLoggedIn ? save : undefined,
    canSaveAs,
    canRunQuery,
    saveAsOpen,
    openSaveAs: isLoggedIn ? () => setSaveAsOpen(true) : undefined,
    closeSaveAs: () => setSaveAsOpen(false),
    saveAs,
    settingsOpen,
    openSettings: isLoggedIn ? () => setSettingsOpen(true) : undefined,
    closeSettings: () => setSettingsOpen(false),
    editSettings: isLoggedIn ? editSettings : undefined,
    toggleActive: isLoggedIn ? toggleActive : undefined,
    toggleDefault: isLoggedIn ? toggleDefault : undefined,
    reorderReport: isLoggedIn ? reorderReport : undefined,
    sortAlphabetical: isLoggedIn ? sortAlphabetical : undefined,
    refresh,
  };
}
