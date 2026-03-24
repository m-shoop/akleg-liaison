import { useEffect, useRef, useState } from "react";
import { fetchJob } from "../api/jobs";

const POLL_INTERVAL_MS = 2500;
const TERMINAL_STATUSES = new Set(["complete", "failed"]);

/**
 * Polls GET /jobs/{jobId} every 2.5 seconds until the job reaches a
 * terminal state (complete or failed), then stops.
 *
 * Returns { status, result, error } — all null until the first poll responds.
 * Pass null as jobId to keep the hook idle.
 */
export function useJob(jobId) {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;

    // Reset state when a new job starts
    setStatus(null);
    setResult(null);
    setError(null);

    async function poll() {
      try {
        const job = await fetchJob(jobId);
        setStatus(job.status);
        setResult(job.result ?? null);
        setError(job.error ?? null);
        if (TERMINAL_STATUSES.has(job.status)) {
          clearInterval(intervalRef.current);
        }
      } catch {
        // Network hiccup — keep polling, don't surface the error
      }
    }

    poll(); // Fire immediately, don't wait for first interval
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => clearInterval(intervalRef.current);
  }, [jobId]);

  return { status, result, error };
}
