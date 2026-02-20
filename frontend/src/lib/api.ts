interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiFetch(
  path: string,
  init?: ApiFetchOptions
): Promise<Response> {
  const { skipAuth, ...fetchInit } = init ?? {};

  const headers = new Headers(fetchInit.headers);

  if (!skipAuth) {
    const token = localStorage.getItem("access_token");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  return fetch(path, { ...fetchInit, headers });
}
