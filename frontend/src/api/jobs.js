const API = "/api";

export async function fetchJob(jobId) {
  const res = await fetch(`${API}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch job status");
  return res.json();
}
