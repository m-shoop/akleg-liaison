const BASE = "/api";

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function loginRequest(email, password) {
  // OAuth2 expects form-encoded body, not JSON
  const body = new URLSearchParams({ username: email.toLowerCase(), password });
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Login failed");
  }
  return res.json(); // { access_token, token_type, permissions }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function requestRegistrationEmail(email) {
  const res = await fetch(`${BASE}/auth/register/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json(); // { status: "email_sent" | "not_found" | "already_active" | "deleted" }
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

export async function checkForgotPassword(email) {
  const res = await fetch(`${BASE}/auth/forgot-password/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json(); // { status: "not_found" | "inactive" | "active" | "deleted" }
}

export async function requestPasswordResetEmail(email) {
  const res = await fetch(`${BASE}/auth/forgot-password/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json(); // { status: "email_sent" }
}

// ---------------------------------------------------------------------------
// Token validation (shared by registration + password reset)
// ---------------------------------------------------------------------------

export async function validateToken(token, type) {
  const res = await fetch(`${BASE}/auth/validate-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // needed to receive the Set-Cookie response
    body: JSON.stringify({ token, type }),
  });

  if (res.status === 410) {
    // Expired token — detail contains the type ("registration" | "password_reset")
    const body = await res.json().catch(() => ({}));
    const err = new Error("token_expired");
    err.tokenType = body.detail;
    throw err;
  }

  if (!res.ok) {
    throw new Error("invalid_token");
  }

  return res.json(); // { ok: true, purpose: "registration" | "password_reset" }
}

// ---------------------------------------------------------------------------
// Set password
// ---------------------------------------------------------------------------

export async function setPassword(password, confirmPassword) {
  const res = await fetch(`${BASE}/auth/set-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include", // send the set_password_session cookie
    body: JSON.stringify({ password, confirm_password: confirmPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err.detail === "object" ? err.detail.message : (err.detail ?? "Failed to set password")
    );
  }
  return res.json();
}
