const AUTH_TOKEN_STORAGE_KEY = "vitrine.auth.token";
const AUTH_SESSION_STORAGE_KEY = "vitrine.auth.session";

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1").replace(/\/+$/, "");
}

function clearLegacyToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

function setSessionAuthenticated(value: boolean) {
  if (typeof window !== "undefined") {
    if (value) {
      window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, "true");
    } else {
      window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  }
}

function readSessionAuthenticated() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY) === "true";
}

function getCsrfToken() {
  if (typeof window !== "undefined") {
    const cookie = window.document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("csrftoken="));
    return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;
  }
  return null;
}

export function isAuthenticated() {
  return readSessionAuthenticated();
}

export async function login(username: string, password: string) {
  clearLegacyToken();
  const response = await fetch(`${getApiBaseUrl()}/accounts/login/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  });

  if (!response.ok) {
    setSessionAuthenticated(false);
    return false;
  }

  const payload = (await response.json()) as { authenticated?: boolean };

  if (!payload.authenticated) {
    setSessionAuthenticated(false);
    return false;
  }

  setSessionAuthenticated(true);
  return true;
}

export async function logout() {
  clearLegacyToken();
  const csrfToken = getCsrfToken();

  if (isAuthenticated()) {
    try {
      await fetch(`${getApiBaseUrl()}/accounts/logout/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
        },
        body: "{}",
      });
    } catch {
      // Silent fallback: client session is removed locally regardless.
    }
  }

  setSessionAuthenticated(false);
}

export async function validateSession() {
  clearLegacyToken();

  try {
    const response = await fetch(`${getApiBaseUrl()}/accounts/me/`, {
      credentials: "include",
    });

    if (!response.ok) {
      setSessionAuthenticated(false);
      return false;
    }

    setSessionAuthenticated(true);
    return true;
  } catch {
    setSessionAuthenticated(false);
    return false;
  }
}
