import { config } from "../config.js";

/** Call the Coolify v1 API and return parsed JSON (throws on HTTP errors). */
export async function coolify(
  path: string,
  init: RequestInit = {}
): Promise<any> {
  if (!config.coolify.baseUrl || !config.coolify.token) {
    throw new Error(
      "Coolify not configured. Set COOLIFY_BASE_URL and COOLIFY_TOKEN."
    );
  }
  const res = await fetch(`${config.coolify.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.coolify.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  let parsed: any;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = { raw: body };
  }
  if (!res.ok) {
    throw new Error(`Coolify API ${res.status}: ${parsed?.message ?? body}`);
  }
  return parsed;
}
