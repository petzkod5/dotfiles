import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { UsageTotals } from "./types.ts";

export interface FileSelectionInput {
  hint: string;
  statusText: string;
  unstagedDiff: string;
  untracked: string[];
  candidates: string[];
}

export interface MessageInput {
  stagedFiles: string[];
  stagedDiff: string;
}

/** Thrown by generateCommitMessage when the model fails to produce a valid
 *  message after one retry. Carries the usage spent across both attempts so
 *  the caller can still account for it before failing the stage. */
export class CommitMessageError extends Error {
  readonly usage: UsageTotals;
  constructor(message: string, usage: UsageTotals) {
    super(message);
    this.name = "CommitMessageError";
    this.usage = usage;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Spins up a minimal in-memory agent session for a single-shot formatter call.
 * Uses disableExtensionDiscovery:true to prevent recursive self-load.
 * Returns both the trimmed text output and accumulated token/cost usage.
 */
async function runFormatterModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<{ text: string; usage: UsageTotals }> {
  // Model type inferred from resolve() — no @oh-my-pi/pi-ai import needed
  const model = ctx.models.resolve("pi/commit");
  if (!model) throw new Error("pi/commit model unavailable");

  const { session } = await pi.pi.createAgentSession({
    cwd: ctx.cwd,
    model,
    modelRegistry: ctx.modelRegistry,       // reuse session key resolution
    sessionManager: pi.pi.SessionManager.inMemory(ctx.cwd),
    systemPrompt,                            // pure formatter persona; replaces defaults
    toolNames: [],                           // no tools
    enableMCP: false,
    enableLsp: false,
    skipPythonPreflight: true,
    requireYieldTool: false,
    hasUI: false,
    disableExtensionDiscovery: true,         // CRITICAL: prevents recursive self-load
  });

  const onAbort = () => session.abort({ reason: "commit cancelled" });
  signal?.addEventListener("abort", onAbort, { once: true });

  let out = "";
  const acc: UsageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 };

  const unsub = session.subscribe((e) => {
    if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
      out += e.assistantMessageEvent.delta;
    }
    if (e.type === "message_end" && e.message.role === "assistant") {
      const u = e.message.usage;
      acc.inputTokens += u.input ?? 0;
      acc.outputTokens += u.output ?? 0;
      acc.totalTokens += u.totalTokens ?? 0;
      acc.cost += u.cost?.total ?? 0;
    }
  });

  try {
    await session.prompt(userPrompt);
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
    await session.dispose();
  }

  if (signal?.aborted) throw new Error("cancelled");
  return { text: out.trim(), usage: acc };
}

/**
 * Parses the model's file-selection output.
 * Strips code fences → JSON.parse → fallback line scan.
 * Whitelists against candidates and de-duplicates.
 */
function parseFileList(raw: string, candidates: string[]): string[] {
  const candidateSet = new Set(candidates);

  // Strip common code fence wrappers
  let text = raw
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  let paths: string[] = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      paths = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // Fallback: scan lines for any token that exactly equals a candidate path
    paths = text
      .split("\n")
      .map((l) => l.trim().replace(/^["']|["']$/g, "").trim())
      .filter((l) => candidateSet.has(l));
  }

  // Whitelist and de-duplicate
  const seen = new Set<string>();
  return paths.filter((p) => {
    if (!candidateSet.has(p) || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

/**
 * Takes the first non-empty line of the model output, strips wrapping quotes/
 * backticks, and validates the Conventional Commits pattern.
 * Returns the validated line or null if invalid.
 */
function parseCommitLine(raw: string): string | null {
  const firstLine = raw
    .split("\n")
    .find((l) => l.trim().length > 0)
    ?.trim() ?? "";

  // Strip wrapping backticks or quotes
  const stripped = firstLine.replace(/^[`'"]+|[`'"]+$/g, "").trim();

  const valid =
    /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/.test(stripped);

  return valid ? stripped : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Asks the model to pick the on-topic subset of changed files to stage.
 * Returns the selected file paths (subset of input.candidates) and usage totals.
 */
export async function selectFilesToStage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: FileSelectionInput,
  signal?: AbortSignal,
): Promise<{ files: string[]; usage: UsageTotals }> {
  const systemPrompt =
    "You are a git commit file selector. Given changed files and a diff, choose ONLY the files that form ONE coherent, on-topic commit. Respond with ONLY a JSON array of file-path strings — no prose, no markdown, no code fences. If a topic hint is given, prefer files matching it. If everything belongs together, return them all.";

  const userPrompt = [
    `Topic hint: ${input.hint || "(none)"}`,
    "",
    "Changed files (git status --porcelain):",
    input.statusText,
    "",
    "Unstaged diff (truncated):",
    input.unstagedDiff,
    "",
    "Untracked files:",
    input.untracked.length > 0 ? input.untracked.join("\n") : "(none)",
    "",
    "Return a JSON array of the file paths to stage.",
  ].join("\n");

  const { text: raw, usage } = await runFormatterModel(pi, ctx, systemPrompt, userPrompt, signal);
  return { files: parseFileList(raw, input.candidates), usage };
}

/**
 * Generates a single-line Conventional Commits message from the staged diff.
 * Validates the output; re-prompts once on failure. Throws if still invalid.
 * Usage is summed across BOTH calls when the retry path is taken.
 */
export async function generateCommitMessage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: MessageInput,
  signal?: AbortSignal,
): Promise<{ message: string; usage: UsageTotals }> {
  const systemPrompt =
    "You are a Conventional Commits v1.0.0 message generator. Output EXACTLY ONE line: `type(scope): description` — lowercase type from {feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert}, imperative mood, no trailing period, <=72 chars. No body, no quotes, no code fences, no explanation.";

  const userPrompt = [
    "Staged files:",
    input.stagedFiles.join("\n"),
    "",
    "Staged diff (git diff --cached, truncated):",
    input.stagedDiff,
    "",
    "Output the single-line commit message.",
  ].join("\n");

  const { text: raw, usage } = await runFormatterModel(pi, ctx, systemPrompt, userPrompt, signal);
  const line = parseCommitLine(raw);
  if (line !== null) return { message: line, usage };

  // One re-prompt on invalid output
  const retryPrompt =
    userPrompt +
    "\n\nPrevious output was not a valid Conventional Commits line. Return ONLY the corrected single line.";

  const { text: raw2, usage: usage2 } = await runFormatterModel(pi, ctx, systemPrompt, retryPrompt, signal);
  const line2 = parseCommitLine(raw2);

  // Sum usage across both calls regardless of outcome
  const totalUsage: UsageTotals = {
    inputTokens: usage.inputTokens + usage2.inputTokens,
    outputTokens: usage.outputTokens + usage2.outputTokens,
    totalTokens: usage.totalTokens + usage2.totalTokens,
    cost: usage.cost + usage2.cost,
  };

  if (line2 !== null) return { message: line2, usage: totalUsage };

  throw new CommitMessageError(
    "model did not produce a valid Conventional Commits message",
    totalUsage,
  );
}
