/**
 * Drop-in replacement for fetch() that intercepts 401 responses.
 *
 * On a 401, fires a custom "reauth-required" event and waits for the
 * "reauth-complete" event (dispatched by ReauthModal after a successful
 * re-login). The new token is then substituted into the original request
 * and the call is retried once.
 */
export async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status !== 401) return res;

  // Ask the UI to re-authenticate and wait for the new token.
  const newToken = await requestReauth();
  if (!newToken) return res; // user dismissed — return original 401

  // Retry with the fresh token, substituting into Authorization header.
  const retryOptions = {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${newToken}`,
    },
  };
  return fetch(url, retryOptions);
}

function requestReauth() {
  return new Promise((resolve) => {
    // Tell ReauthModal to show itself.
    window.dispatchEvent(new CustomEvent("reauth-required"));

    // ReauthModal dispatches this with detail.token when done, or
    // detail.token = null if the user cancels.
    function handler(e) {
      window.removeEventListener("reauth-complete", handler);
      resolve(e.detail.token);
    }
    window.addEventListener("reauth-complete", handler);
  });
}
