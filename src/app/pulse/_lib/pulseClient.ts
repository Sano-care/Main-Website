// Tiny client-side fetch wrapper for the Pulse API. Centralises two things
// every surface needs: JSON parsing, and the 401 → bounce-to-login behaviour
// (the OTP cookie can expire mid-session; when it does we send the patient
// back to sign in, preserving where they were).

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

/** True once we've started a login redirect, so we don't fire several. */
let redirecting = false;

function bounceToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  const here =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/pulse";
  window.location.assign(`/pulse/login?next=${encodeURIComponent(here)}`);
}

/**
 * Fetch a Pulse API route and parse JSON. On 401, redirects to login and
 * leaves the returned promise pending-ish (the page is navigating away), so
 * callers don't need to special-case auth expiry beyond a try/catch.
 */
export async function pulseFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    bounceToLogin();
  }

  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
