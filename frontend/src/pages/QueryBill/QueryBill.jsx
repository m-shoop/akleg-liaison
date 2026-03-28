import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBills, refreshBill } from "../../api/bills";
import { useAuth } from "../../context/AuthContext";
import { useJob } from "../../hooks/useJob";
import Toast from "../../components/Toast/Toast";
import styles from "./QueryBill.module.css";

export default function QueryBill() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [billsError, setBillsError] = useState(null);
  const [selectedBillId, setSelectedBillId] = useState("");
  const [jobId, setJobId] = useState(null);
  const [toast, setToast] = useState(null);

  const { status: jobStatus, error: jobError } = useJob(jobId);

  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === "complete") {
      const bill = bills.find((b) => b.id === Number(selectedBillId) || b.id === selectedBillId);
      navigate("/", { state: { toast: "Bill queried successfully.", search: bill?.bill_number ?? "" } });
    }
    if (jobStatus === "failed") {
      setToast({ message: jobError ?? "Query failed.", type: "error" });
      setJobId(null);
    }
  }, [jobStatus]);

  useEffect(() => {
    fetchBills()
      .then((data) => {
        const sorted = [...data].sort((a, b) => {
          const chamberA = a.bill_number.startsWith("HB") ? 0 : 1;
          const chamberB = b.bill_number.startsWith("HB") ? 0 : 1;
          const numA = parseInt(a.bill_number.replace(/\D/g, ""), 10);
          const numB = parseInt(b.bill_number.replace(/\D/g, ""), 10);
          return chamberA - chamberB || numA - numB;
        });
        setBills(sorted);
      })
      .catch((err) => setBillsError(err.message))
      .finally(() => setBillsLoading(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedBillId) return;
    try {
      const job = await refreshBill(selectedBillId, token);
      setJobId(job.id);
    } catch (err) {
      setToast({ message: err.message, type: "error" });
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.description}>
          Leg Up automatically refreshes its data every day at 4:05AM and 4:05PM local Juneau time.
          <br /><br />
          If you need to refresh a bill's data, you can use this form below
          to request a refresh from the Alaska State Government website. 
          <br /> <br />
          Only tracked 
          bills appear in the selection drop-down.
        </p>
        <h1 className={styles.title}>Query a Bill</h1>
        <p className={styles.subtitle}>34th Alaska Legislature</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Tracked Bill
            {billsLoading && <span className={styles.loadingNote}>Loading bills…</span>}
            {billsError && <span className={styles.errorNote}>{billsError}</span>}
            <select
              className={styles.select}
              value={selectedBillId}
              onChange={(e) => setSelectedBillId(e.target.value)}
              disabled={billsLoading || !!billsError}
              required
            >
              <option value="">— Select a bill —</option>
              {bills.map((bill) => (
                <option key={bill.id} value={bill.id}>
                  {bill.bill_number}
                  {bill.short_title ? ` — ${bill.short_title}` : ""}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!!jobId || !selectedBillId}
          >
            {jobId ? "Querying…" : "Query Bill"}
          </button>
        </form>
        <Toast
          message={toast?.message}
          type={toast?.type}
          onDismiss={() => setToast(null)}
        />
      </div>
    </div>
  );
}
