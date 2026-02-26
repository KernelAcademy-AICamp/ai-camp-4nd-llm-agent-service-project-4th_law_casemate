interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

// 환경변수에서 API URL 가져오기 (프로덕션: Lightsail 주소, 개발: 빈 문자열)
export const API_URL = import.meta.env.VITE_API_URL || '';

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

  return fetch(API_URL + path, { ...fetchInit, headers });
}
