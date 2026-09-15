export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(!(init?.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (
    response.status === 401 &&
    !path.startsWith("/login") &&
    !path.startsWith("/session")
  ) {
    location.href = "/login";
    throw Error("请重新登录");
  }
  if (!response.ok) {
    const body: unknown = await response
      .json()
      .catch(() => ({ error: "服务连接失败" }));
    const data =
      body && typeof body === "object"
        ? (body as { code?: unknown; error?: unknown })
        : {};
    if (data.code === "PASSWORD_CHANGE_REQUIRED") {
      window.dispatchEvent(new Event("account-required"));
    }
    throw Error(typeof data.error === "string" ? data.error : "请求失败");
  }
  return response.json() as Promise<T>;
}

export const json = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});

export const media = (file: string) =>
  `/media/${file.split("/").map(encodeURIComponent).join("/")}`;
