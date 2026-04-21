const AUTH_TOKEN_STORAGE_KEY = "vitrine.auth.token";

function getApiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1").replace(/\/+$/, "");
}

export function getAuthToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function isAuthenticated() {
  return !!getAuthToken();
}

function storeToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  }
}

function clearToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

export async function login(username: string, password: string) {
  const response = await fetch(`${getApiBaseUrl()}/accounts/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  });

  if (!response.ok) {
    clearToken();
    return false;
  }

  const payload = (await response.json()) as { token?: string };

  if (!payload.token) {
    clearToken();
    return false;
  }

  storeToken(payload.token);
  return true;
}

export async function logout() {
  const token = getAuthToken();

  if (token) {
    try {
      await fetch(`${getApiBaseUrl()}/accounts/logout/`, {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    } catch {
      // Silent fallback: token is removed locally regardless.
    }
  }

  clearToken();
}

export async function validateSession() {
  const token = getAuthToken();

  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/accounts/me/`, {
      headers: {
        Authorization: `Token ${token}`,
      },
    });

    if (!response.ok) {
      clearToken();
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
