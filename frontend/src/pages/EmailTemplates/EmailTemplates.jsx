import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  fetchEmailTemplate,
  fetchEmailTemplates,
  fetchPreviewHearings,
  fetchTemplateVariables,
  previewEmailTemplate,
  testSendEmailTemplate,
  updateEmailTemplate,
} from "../../api/email";
import styles from "./EmailTemplates.module.css";

export default function EmailTemplates() {
  const { token, can } = useAuth();
  const isAdmin = can("email-template:edit");

  const [templates, setTemplates] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [variables, setVariables] = useState([]);
  const [hearings, setHearings] = useState([]);

  const [subject, setSubject] = useState("");
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [defaultCcEmail, setDefaultCcEmail] = useState("");
  const [previewHearingId, setPreviewHearingId] = useState("");
  const [previewBillId, setPreviewBillId] = useState("");
  const [previewCancelReason, setPreviewCancelReason] = useState(
    "Bill removed from agenda (sample reason)",
  );
  const [previewAssignmentType, setPreviewAssignmentType] = useState("monitoring");
  const [preview, setPreview] = useState(null);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const dirty = useMemo(() => {
    if (!activeTemplate) return false;
    return (
      subject !== activeTemplate.subject_template ||
      bodyMarkdown !== activeTemplate.body_markdown ||
      defaultCcEmail !== (activeTemplate.default_cc_email ?? "")
    );
  }, [activeTemplate, subject, bodyMarkdown, defaultCcEmail]);

  // Initial loads — templates list, variables list, preview hearings.
  useEffect(() => {
    if (!isAdmin || !token) return;
    Promise.all([
      fetchEmailTemplates(token),
      fetchTemplateVariables(token),
      fetchPreviewHearings(token),
    ])
      .then(([tmpls, vars, hrs]) => {
        setTemplates(tmpls);
        setVariables(vars);
        setHearings(hrs);
        if (tmpls.length > 0 && activeKey === null) {
          setActiveKey(tmpls[0].template_key);
        }
        if (hrs.length > 0) {
          setPreviewHearingId(String(hrs[0].id));
          const firstBill = hrs[0].bills?.[0];
          setPreviewBillId(firstBill ? String(firstBill.bill_id) : "");
        }
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, token]);

  // Load full template detail when the active key changes.
  useEffect(() => {
    if (!activeKey || !token) return;
    fetchEmailTemplate(activeKey, token)
      .then((t) => {
        setActiveTemplate(t);
        setSubject(t.subject_template);
        setBodyMarkdown(t.body_markdown);
        setDefaultCcEmail(t.default_cc_email ?? "");
        setPreview(null);
      })
      .catch((err) => setError(err.message));
  }, [activeKey, token]);

  // The cancellation template uses the {cancellation_reason} variable, which
  // only has a real value during an actual cancel flow. Without a sample, the
  // preview shows "Reason:" with nothing after it.
  const isCancelTemplate = activeKey?.includes("canceled");

  const previewHearing = useMemo(
    () => hearings.find((h) => String(h.id) === previewHearingId) ?? null,
    [hearings, previewHearingId],
  );
  const previewBills = previewHearing?.bills ?? [];

  // Reset the bill picker when the hearing changes (or when the previously
  // selected bill is no longer on the new hearing's agenda). Mirrors the
  // assignment-modal pattern: bill choices are scoped to a specific hearing.
  useEffect(() => {
    if (previewBills.length === 0) {
      if (previewBillId !== "") setPreviewBillId("");
      return;
    }
    const stillPresent = previewBills.some(
      (b) => String(b.bill_id) === previewBillId,
    );
    if (!stillPresent) {
      setPreviewBillId(String(previewBills[0].bill_id));
    }
  }, [previewBills, previewBillId]);

  // Default the Sample Assignment Type to match the template's intent so an
  // admin opening the awareness template sees "Awareness" in the preview
  // without having to set it.
  useEffect(() => {
    if (activeKey === "hearing_assignment_awareness") {
      setPreviewAssignmentType("awareness");
    } else if (activeKey === "hearing_assignment_monitoring") {
      setPreviewAssignmentType("monitoring");
    }
  }, [activeKey]);

  // Re-render the preview when subject/body/hearing/sample-reason changes (debounced).
  useEffect(() => {
    if (!activeKey || !previewHearingId) return;
    const handle = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        // Save first if dirty? No — preview always uses the in-flight content.
        // The server-side preview endpoint reads the persisted template, so
        // if the editor is dirty we save first transparently — but that's
        // surprising. Instead we render against the saved template and add a
        // hint that previews reflect the saved version.
        const result = await previewEmailTemplate(
          activeKey,
          parseInt(previewHearingId, 10),
          token,
          {
            billId: previewBillId ? parseInt(previewBillId, 10) : undefined,
            assignmentType: previewAssignmentType,
            ...(isCancelTemplate ? { cancellationReason: previewCancelReason } : {}),
          },
        );
        setPreview(result);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingPreview(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [
    activeKey,
    previewHearingId,
    previewBillId,
    activeTemplate,
    token,
    isCancelTemplate,
    previewCancelReason,
    previewAssignmentType,
  ]);

  async function handleSave() {
    if (!activeKey) return;
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const updated = await updateEmailTemplate(
        activeKey,
        {
          subject_template: subject,
          body_markdown: bodyMarkdown,
          default_cc_email: defaultCcEmail.trim() || null,
        },
        token,
      );
      setActiveTemplate(updated);
      setStatusMsg("Saved.");
      // Force a re-preview against the freshly saved version.
      if (previewHearingId) {
        const result = await previewEmailTemplate(
          activeKey,
          parseInt(previewHearingId, 10),
          token,
          {
            billId: previewBillId ? parseInt(previewBillId, 10) : undefined,
            assignmentType: previewAssignmentType,
            ...(isCancelTemplate ? { cancellationReason: previewCancelReason } : {}),
          },
        );
        setPreview(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    if (!activeKey || !previewHearingId) return;
    setTesting(true);
    setError(null);
    setStatusMsg(null);
    try {
      const { sent_to } = await testSendEmailTemplate(
        activeKey,
        parseInt(previewHearingId, 10),
        token,
        {
          billId: previewBillId ? parseInt(previewBillId, 10) : undefined,
          assignmentType: previewAssignmentType,
          ...(isCancelTemplate ? { cancellationReason: previewCancelReason } : {}),
        },
      );
      setStatusMsg(`Test email sent to ${sent_to}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Email Templates</h1>

      <div className={styles.layout}>
        {/* Left rail: template picker */}
        <aside className={styles.sidebar}>
          {templates.map((t) => (
            <button
              key={t.template_key}
              type="button"
              className={
                t.template_key === activeKey
                  ? `${styles.sideBtn} ${styles.sideBtnActive}`
                  : styles.sideBtn
              }
              onClick={() => setActiveKey(t.template_key)}
            >
              <div className={styles.sideName}>{t.name}</div>
              <div className={styles.sideKey}>{t.template_key}</div>
            </button>
          ))}
        </aside>

        {/* Editor + Preview */}
        <section className={styles.editorPanel}>
          {activeTemplate && (
            <>
              <p className={styles.helper}>
                Variables you can use:{" "}
                {variables.map((v) => (
                  <code key={v} className={styles.varTag}>{`{${v}}`}</code>
                ))}
              </p>

              <label className={styles.fieldLabel}>
                Subject
                <input
                  className={styles.input}
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>

              <label className={styles.fieldLabel}>
                Default CC (optional)
                <input
                  className={styles.input}
                  type="email"
                  value={defaultCcEmail}
                  onChange={(e) => setDefaultCcEmail(e.target.value)}
                  placeholder="e.g. director@example.com"
                />
                <span className={styles.helper}>
                  When set, every email sent using this template is CC'd to
                  this address. Recipients who have opted out still suppress
                  the whole send (no CC either).
                </span>
              </label>

              <label className={styles.fieldLabel}>
                Body (Markdown)
                <textarea
                  className={styles.textarea}
                  rows={14}
                  value={bodyMarkdown}
                  onChange={(e) => setBodyMarkdown(e.target.value)}
                />
              </label>

              <div className={styles.actionsRow}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleSave}
                  disabled={saving || !dirty}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={handleTestSend}
                  disabled={testing || !previewHearingId}
                >
                  {testing ? "Sending…" : "Test Send (to me)"}
                </button>
                {dirty && (
                  <span className={styles.dirtyMark}>
                    Unsaved changes — Live Preview shows the saved version.
                  </span>
                )}
              </div>

              {error && <p className={styles.error}>{error}</p>}
              {statusMsg && <p className={styles.success}>{statusMsg}</p>}
            </>
          )}
        </section>

        {/* Live preview */}
        <section className={styles.previewPanel}>
          <h2 className={styles.previewTitle}>Live Preview</h2>
          <label className={styles.fieldLabel}>
            Hearing
            <select
              className={styles.input}
              value={previewHearingId}
              onChange={(e) => setPreviewHearingId(e.target.value)}
            >
              {hearings.length === 0 && <option value="">(no hearings)</option>}
              {hearings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldLabel}>
            Bill
            <select
              className={styles.input}
              value={previewBillId}
              onChange={(e) => setPreviewBillId(e.target.value)}
              disabled={previewBills.length === 0}
            >
              {previewBills.length === 0 && (
                <option value="">— No bills on this hearing's agenda —</option>
              )}
              {previewBills.map((b) => (
                <option key={b.bill_id} value={b.bill_id}>
                  {b.bill_number}{b.content ? ` — ${b.content}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldLabel}>
            Sample Assignment Type
            <select
              className={styles.input}
              value={previewAssignmentType}
              onChange={(e) => setPreviewAssignmentType(e.target.value)}
            >
              <option value="monitoring">Monitoring Reports</option>
              <option value="awareness">Awareness</option>
            </select>
          </label>

          {isCancelTemplate && (
            <label className={styles.fieldLabel}>
              Sample cancellation reason
              <input
                type="text"
                className={styles.input}
                value={previewCancelReason}
                onChange={(e) => setPreviewCancelReason(e.target.value)}
                placeholder="e.g. Bill removed from agenda"
              />
            </label>
          )}

          {loadingPreview && <p className={styles.muted}>Rendering…</p>}
          {preview && !loadingPreview && (
            <>
              <div className={styles.previewSubject}>
                <span className={styles.previewLabel}>Subject</span>
                <span>{preview.subject}</span>
              </div>
              <div className={styles.previewIframeWrapper}>
                <iframe
                  title="email-preview"
                  className={styles.previewIframe}
                  srcDoc={preview.html_body}
                  sandbox=""
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
