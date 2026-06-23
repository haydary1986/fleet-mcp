import { config, type CloudflareAccount } from "../config.js";

const API = "https://api.cloudflare.com/client/v4";

/** Resolve a configured Cloudflare account (defaults to the first one). */
export function account(key?: string): CloudflareAccount {
  const accounts = config.cloudflare;
  if (accounts.length === 0) {
    throw new Error(
      'Cloudflare not configured. Set CF_ACCOUNTS="main:token,secondary:token".'
    );
  }
  if (!key) return accounts[0];
  const found = accounts.find((a) => a.key === key);
  if (!found) {
    throw new Error(
      `Unknown Cloudflare account "${key}". Known: ${accounts.map((a) => a.key).join(", ")}`
    );
  }
  return found;
}

/** Call the Cloudflare v4 API and return parsed JSON (throws on API errors). */
export async function cf(
  accountKey: string | undefined,
  path: string,
  init: RequestInit = {}
): Promise<any> {
  const acc = account(accountKey);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${acc.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const errs =
      json?.errors?.map((e: any) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare API ${res.status}: ${errs}`);
  }
  return json;
}

/** Call a Cloudflare endpoint that returns plain text (e.g. BIND export). */
export async function cfText(
  accountKey: string | undefined,
  path: string
): Promise<string> {
  const acc = account(accountKey);
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${acc.token}` },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Cloudflare API ${res.status}: ${body}`);
  return body;
}

/** Import a BIND zone file into a zone (used to restore a backup). */
export async function cfImportBind(
  accountKey: string | undefined,
  zone: string,
  bind: string,
  proxied?: boolean
): Promise<any> {
  const acc = account(accountKey);
  const form = new FormData();
  form.append("file", new Blob([bind], { type: "text/plain" }), "zone.txt");
  if (proxied !== undefined) form.append("proxied", String(proxied));
  // Do NOT set Content-Type — fetch sets the multipart boundary automatically.
  const res = await fetch(`${API}/zones/${zone}/dns_records/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acc.token}` },
    body: form,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const errs = json?.errors?.map((e: any) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare import ${res.status}: ${errs}`);
  }
  return json;
}

/** Look up a zone id by domain name within an account. */
export async function zoneId(
  accountKey: string | undefined,
  domain: string
): Promise<string> {
  const j = await cf(accountKey, `/zones?name=${encodeURIComponent(domain)}`);
  if (!j.result?.length) throw new Error(`Zone not found for ${domain}`);
  return j.result[0].id as string;
}
