import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export interface ChangedFile {
  status: string;
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface ScanResult {
  ok: boolean;
  findings: number;
  missing: boolean;
  detail: string;
}

export async function isGitRepo(pi: ExtensionAPI, cwd: string): Promise<boolean> {
  const r = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function listChangedFiles(pi: ExtensionAPI, cwd: string): Promise<ChangedFile[]> {
  const r = await pi.exec(
    "git",
    ["-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
    { cwd },
  );
  if (r.code !== 0 || !r.stdout) return [];

  // Split on NUL; each entry is "XY PATH"; renames add a second source-path token
  const tokens = r.stdout.split("\0").filter((t) => t.length > 0);
  const files: ChangedFile[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i++];
    if (token.length < 3) continue;
    const X = token[0];
    const Y = token[1];
    const path = token.slice(3);
    // Rename / copy: next token is the source path — consume it without adding
    if (X === "R" || X === "C" || Y === "R" || Y === "C") {
      i++; // consume source path
    }
    const staged = X !== " " && X !== "?";
    const unstaged = Y !== " ";
    const untracked = X === "?" && Y === "?";
    files.push({ status: X + Y, path, staged, unstaged, untracked });
  }
  return files;
}

export async function statusText(pi: ExtensionAPI, cwd: string): Promise<string> {
  const r = await pi.exec(
    "git",
    ["-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all"],
    { cwd },
  );
  return r.stdout;
}

export async function unstagedDiff(pi: ExtensionAPI, cwd: string, maxBytes = 100000): Promise<string> {
  const r = await pi.exec(
    "git",
    ["-c", "core.quotepath=false", "diff", "--no-color"],
    { cwd },
  );
  return r.stdout.slice(0, maxBytes);
}

export async function untrackedFiles(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const r = await pi.exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd });
  return r.stdout.split("\n").filter((l) => l.length > 0);
}

export async function stageFiles(
  pi: ExtensionAPI,
  cwd: string,
  files: string[],
  signal?: AbortSignal,
): Promise<void> {
  const r = await pi.exec("git", ["add", "--", ...files], { cwd, signal });
  if (r.code !== 0) {
    const firstLine = r.stderr.split("\n")[0] ?? r.stderr;
    throw new Error(firstLine || "git add failed");
  }
}

export async function hasStagedChanges(pi: ExtensionAPI, cwd: string): Promise<boolean> {
  // exit 1 = has staged changes; exit 0 = none
  const r = await pi.exec("git", ["diff", "--cached", "--quiet"], { cwd });
  return r.code === 1;
}

export async function stagedDiff(pi: ExtensionAPI, cwd: string, maxBytes = 100000): Promise<string> {
  const r = await pi.exec(
    "git",
    ["-c", "core.quotepath=false", "diff", "--cached", "--no-color"],
    { cwd },
  );
  return r.stdout.slice(0, maxBytes);
}

export async function stagedFileList(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const r = await pi.exec("git", ["diff", "--cached", "--name-only"], { cwd });
  return r.stdout.split("\n").filter((l) => l.length > 0);
}

/** Commits the staged changes and returns the short HEAD hash. */
export async function commit(
  pi: ExtensionAPI,
  cwd: string,
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  const r = await pi.exec("git", ["commit", "-m", message], { cwd, signal });
  if (r.code !== 0) {
    const firstLine = r.stderr.split("\n")[0] ?? r.stderr;
    throw new Error(firstLine || "git commit failed");
  }
  const hashResult = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { cwd });
  return hashResult.stdout.trim();
}

/**
 * Scans ONLY staged changes with gitleaks.
 * - code 0  → clean
 * - code 1  → findings (secrets)  → ok:false (FAIL, never skip)
 * - ENOENT / code 127 / stderr ENOENT → gitleaks missing (FAIL, never skip)
 * - other non-zero → gitleaks error (FAIL)
 */
export async function scanStagedSecrets(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
): Promise<ScanResult> {
  let r: { stdout: string; stderr: string; code: number; killed: boolean };
  try {
    r = await pi.exec(
      "gitleaks",
      ["git", "--staged", "--no-banner", "--redact", "--report-format", "json", "--report-path", "-"],
      { cwd, signal },
    );
  } catch {
    // ENOENT or other exec-level failure — gitleaks not installed
    return { ok: false, findings: 0, missing: true, detail: "gitleaks not available — scan is mandatory" };
  }

  if (r.code === 0) {
    return { ok: true, findings: 0, missing: false, detail: "no secrets found" };
  }

  // Distinguish "binary not found" from "leaks found"
  if (r.code === 127 || /not found|ENOENT/i.test(r.stderr)) {
    return { ok: false, findings: 0, missing: true, detail: "gitleaks not available — scan is mandatory" };
  }

  if (r.code === 1) {
    let findings = 1;
    try {
      const parsed = JSON.parse(r.stdout) as unknown;
      if (Array.isArray(parsed)) findings = parsed.length;
    } catch {
      findings = 1;
    }
    return {
      ok: false,
      findings,
      missing: false,
      detail: `${findings} potential secret(s) detected`,
    };
  }

  // Any other non-zero exit (e.g. gitleaks config error)
  return {
    ok: false,
    findings: 0,
    missing: false,
    detail: r.stderr.trim() || "gitleaks error",
  };
}

/**
 * Unstages files that were staged by this extension. Best-effort cleanup:
 * errors are swallowed (logged) so that a failed unstage never blocks
 * the caller's own cancellation path.
 * No-op when `files` is empty.
 */
export async function unstageFiles(
  pi: ExtensionAPI,
  cwd: string,
  files: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (files.length === 0) return;
  try {
    const r = await pi.exec("git", ["restore", "--staged", "--", ...files], { cwd, signal });
    if (r.code !== 0) {
      pi.logger.warn(`unstageFiles: git restore --staged exited ${r.code}: ${r.stderr.trim()}`);
    }
  } catch (err: unknown) {
    pi.logger.warn(`unstageFiles: ${err instanceof Error ? err.message : String(err)}`);
  }
}
