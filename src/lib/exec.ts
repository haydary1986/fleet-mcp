import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config, requireSsh } from "../config.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecOptions {
  cwd?: string;
  /** Override the default timeout — useful for long jobs (downloads, installs). */
  timeoutMs?: number;
}

async function run(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: opts.timeoutMs ?? config.execTimeoutMs,
      maxBuffer: MAX_BUFFER,
      cwd: opts.cwd,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 };
  } catch (err: any) {
    return {
      stdout: err?.stdout?.toString() ?? "",
      stderr: err?.stderr?.toString() ?? String(err?.message ?? err),
      code: typeof err?.code === "number" ? err.code : 1,
    };
  }
}

/** Run a command on the local machine. Arguments are passed safely (no shell). */
export function runLocal(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return run(file, args, opts);
}

function sshArgs(target: string, command: string): string[] {
  const opts = config.ssh.options ? config.ssh.options.split(/\s+/).filter(Boolean) : [];
  return [...opts, target, command];
}

/** Run a shell command on a specific SSH target. */
export function runRemoteOn(target: string, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return run("ssh", sshArgs(target, command), opts);
}

/** Run a shell command on the default fleet server (FLEET_SSH_TARGET). */
export function runRemote(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return runRemoteOn(requireSsh(), command, opts);
}
