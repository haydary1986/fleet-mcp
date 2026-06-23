import type { ExecResult } from "./exec.js";

/** Standard text tool response. */
export function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/** Error tool response — the model sees this as a failed call it can react to. */
export function errorText(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true as const };
}

/** Pretty-print any JSON value as a text response. */
export function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

/** Format the result of an exec'd command into a tool response. */
export function fromExec(r: ExecResult) {
  const parts: string[] = [];
  if (r.stdout.trim()) parts.push(r.stdout.trim());
  if (r.stderr.trim()) parts.push(`[stderr]\n${r.stderr.trim()}`);
  const body = parts.join("\n\n") || "(no output)";
  return r.code === 0 ? text(body) : errorText(`exit ${r.code}\n${body}`);
}

/** Wrap a handler so thrown errors become clean MCP error responses. */
export function safe<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | ReturnType<typeof errorText>> => {
    try {
      return await fn(...args);
    } catch (err: any) {
      return errorText(String(err?.message ?? err));
    }
  };
}
