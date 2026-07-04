import type {
  CommitResult,
  CommitState,
  Repaint,
  StageId,
  UsageTotals,
  WorkflowOptions,
} from "./types.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import * as git from "./git.ts";
import { selectFilesToStage, generateCommitMessage, CommitMessageError } from "./model.ts";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createInitialState(): CommitState {
  return {
    stages: [
      { id: "stage",   label: "Stage files",       status: "todo" },
      { id: "scan",    label: "Scan for secrets",   status: "todo" },
      { id: "message", label: "Generate message",   status: "todo" },
      { id: "commit",  label: "Create commit",      status: "todo" },
    ],
    done: false,
    awaitingApproval: false,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStage(state: CommitState, id: StageId) {
  return state.stages.find((s) => s.id === id)!;
}

function cancelled(state: CommitState): CommitResult {
  state.outcome = "cancelled";
  return { status: "cancelled" };
}

/** Accumulate model usage into the running state total. */
function addUsage(state: CommitState, u: UsageTotals): void {
  state.usage.inputTokens += u.inputTokens;
  state.usage.outputTokens += u.outputTokens;
  state.usage.totalTokens += u.totalTokens;
  state.usage.cost += u.cost;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Drives the 4-stage commit workflow.
 *
 * Matches the RunCommitWorkflow seam (pi, ctx, state, repaint, signal, options?).
 * options.hint     — topic hint for file selection (from /commit args)
 * options.yolo     — skip the approval gate and auto-commit
 * options.awaitApproval — resolves with the in-overlay gate decision
 */
export async function runCommitWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: CommitState,
  repaint: Repaint,
  signal: AbortSignal,
  options?: WorkflowOptions,
): Promise<CommitResult> {

  // ------------------------------------------------------------------
  // Pre-flight: clean working tree?
  // ------------------------------------------------------------------
  const changedFiles = await git.listChangedFiles(pi, ctx.cwd);

  if (signal.aborted) return cancelled(state);

  if (changedFiles.length === 0) {
    state.outcome = "clean";
    return { status: "clean" };
  }

  // Track which files were already staged before this run so we never
  // roll them back on abort.
  const preStaged = new Set(changedFiles.filter((f) => f.staged).map((f) => f.path));
  // Files staged by THIS run (populated after stageFiles succeeds).
  let extStaged: string[] = [];

  /**
   * Best-effort rollback: unstage only what this run staged.
   * No signal passed — cleanup must run even when the signal is aborted.
   */
  async function abortCleanup(): Promise<void> {
    if (extStaged.length) {
      try {
        await git.unstageFiles(pi, ctx.cwd, extStaged);
      } catch {
        // best-effort; ignore
      }
    }
  }

  // ------------------------------------------------------------------
  // Stage 1 — Stage files
  // ------------------------------------------------------------------
  const stageStage = getStage(state, "stage");
  stageStage.status = "in-progress";
  stageStage.startedAtMs = Date.now();
  stageStage.elapsedMs = undefined;
  repaint();

  try {
    // Files not already staged — the model picks from these
    const candidates = changedFiles
      .filter((f) => (f.unstaged || f.untracked) && !f.staged)
      .map((f) => f.path);

    const alreadyStagedCount = changedFiles.filter((f) => f.staged).length;

    if (candidates.length > 0) {
      // Gather context for the model
      const [stText, udiff, untracked] = await Promise.all([
        git.statusText(pi, ctx.cwd),
        git.unstagedDiff(pi, ctx.cwd),
        git.untrackedFiles(pi, ctx.cwd),
      ]);

      if (signal.aborted) {
        stageStage.status = "todo";
        await abortCleanup();
        return cancelled(state);
      }

      const { files: selected, usage: selUsage } = await selectFilesToStage(
        pi,
        ctx,
        { hint: options?.hint ?? "", statusText: stText, unstagedDiff: udiff, untracked, candidates },
        signal,
      );
      addUsage(state, selUsage);
      repaint();

      if (signal.aborted) {
        stageStage.status = "todo";
        await abortCleanup();
        return cancelled(state);
      }

      if (selected.length === 0 && alreadyStagedCount === 0) {
        // Model found nothing on-topic and nothing was pre-staged → clean stop
        stageStage.status = "done";
        stageStage.elapsedMs = Date.now() - (stageStage.startedAtMs ?? Date.now());
        stageStage.subtitle = "no on-topic changes to stage";
        state.outcome = "clean";
        repaint();
        return { status: "clean" };
      }

      if (selected.length > 0) {
        await git.stageFiles(pi, ctx.cwd, selected, signal);
        // Record what this run staged (excluding anything the user had pre-staged).
        extStaged = selected.filter((f) => !preStaged.has(f));
        if (signal.aborted) {
          stageStage.status = "todo";
          await abortCleanup();
          return cancelled(state);
        }
      }
    }
    // else: no candidates (all files already staged) → proceed with the pre-staged set

    // Verify that something is actually staged
    const hasSt = await git.hasStagedChanges(pi, ctx.cwd);

    if (signal.aborted) {
      stageStage.status = "todo";
      await abortCleanup();
      return cancelled(state);
    }

    if (!hasSt) {
      stageStage.status = "done";
      stageStage.elapsedMs = Date.now() - (stageStage.startedAtMs ?? Date.now());
      stageStage.subtitle = "no on-topic changes to stage";
      state.outcome = "clean";
      repaint();
      return { status: "clean" };
    }

    // Diff summary for the subtitle (3 file(s), +42/-7)
    const ds = await git.diffStat(pi, ctx.cwd, signal);
    stageStage.status = "done";
    stageStage.elapsedMs = Date.now() - (stageStage.startedAtMs ?? Date.now());
    stageStage.subtitle = `${ds.files} file(s), +${ds.insertions}/-${ds.deletions}`;
    repaint();

  } catch (err: unknown) {
    if (signal.aborted) {
      stageStage.status = "todo";
      await abortCleanup();
      return cancelled(state);
    }
    const msg = err instanceof Error ? err.message : String(err);
    stageStage.status = "failed";
    stageStage.elapsedMs = Date.now() - (stageStage.startedAtMs ?? Date.now());
    stageStage.subtitle = msg;
    state.error = msg;
    state.outcome = "failed";
    repaint();
    return { status: "failed", failedStage: "stage", error: msg };
  }

  if (signal.aborted) { await abortCleanup(); return cancelled(state); }

  // ------------------------------------------------------------------
  // Stage 2 — Scan for secrets
  // ------------------------------------------------------------------
  const scanStage = getStage(state, "scan");
  scanStage.status = "in-progress";
  scanStage.startedAtMs = Date.now();
  scanStage.elapsedMs = undefined;
  repaint();

  try {
    const scanResult = await git.scanStagedSecrets(pi, ctx.cwd, signal);

    if (signal.aborted) {
      scanStage.status = "todo";
      await abortCleanup();
      return cancelled(state);
    }

    if (!scanResult.ok) {
      const msg = scanResult.missing
        ? "gitleaks not available — scan is mandatory"
        : scanResult.findings > 0
          ? `${scanResult.findings} potential secret(s) detected — commit blocked`
          : scanResult.detail;
      scanStage.status = "failed";
      scanStage.elapsedMs = Date.now() - (scanStage.startedAtMs ?? Date.now());
      scanStage.subtitle = msg;
      state.error = msg;
      state.outcome = "failed";
      repaint();
      return { status: "failed", failedStage: "scan", error: msg };
    }

    const stagedCount = await git.stagedFileList(pi, ctx.cwd);
    scanStage.status = "done";
    scanStage.elapsedMs = Date.now() - (scanStage.startedAtMs ?? Date.now());
    scanStage.subtitle = `no secrets found (${stagedCount.length} staged file(s))`;
    repaint();

  } catch (err: unknown) {
    if (signal.aborted) {
      scanStage.status = "todo";
      await abortCleanup();
      return cancelled(state);
    }
    const msg = err instanceof Error ? err.message : String(err);
    scanStage.status = "failed";
    scanStage.elapsedMs = Date.now() - (scanStage.startedAtMs ?? Date.now());
    scanStage.subtitle = msg;
    state.error = msg;
    state.outcome = "failed";
    repaint();
    return { status: "failed", failedStage: "scan", error: msg };
  }

  if (signal.aborted) { await abortCleanup(); return cancelled(state); }

  // ------------------------------------------------------------------
  // Stage 3 — Generate message (+ approval gate, loops on "regenerate")
  //
  // Staging (Stage 1) and scan (Stage 2) run ONCE before this loop.
  // "regenerate" re-runs only message generation and shows the gate again.
  // ------------------------------------------------------------------
  const msgStage = getStage(state, "message");

  while (true) {
    // Reset timing for each generation attempt (including regenerations).
    msgStage.status = "in-progress";
    msgStage.startedAtMs = Date.now();
    msgStage.elapsedMs = undefined;
    msgStage.subtitle = undefined;
    repaint();

    try {
      const [stagedFiles, sDiff] = await Promise.all([
        git.stagedFileList(pi, ctx.cwd),
        git.stagedDiff(pi, ctx.cwd),
      ]);

      if (signal.aborted) {
        msgStage.status = "todo";
        await abortCleanup();
        return cancelled(state);
      }

      const { message, usage: msgUsage } = await generateCommitMessage(
        pi, ctx, { stagedFiles, stagedDiff: sDiff }, signal,
      );

      if (signal.aborted) {
        msgStage.status = "todo";
        await abortCleanup();
        return cancelled(state);
      }

      state.message = message;
      msgStage.status = "done";
      msgStage.elapsedMs = Date.now() - (msgStage.startedAtMs ?? Date.now());
      msgStage.subtitle = message;
      addUsage(state, msgUsage);
      repaint();

    } catch (err: unknown) {
      if (signal.aborted) {
        msgStage.status = "todo";
        await abortCleanup();
        return cancelled(state);
      }
      // Count tokens spent on discarded drafts even when generation fails.
      if (err instanceof CommitMessageError) addUsage(state, err.usage);
      const msg = err instanceof Error ? err.message : String(err);
      msgStage.status = "failed";
      msgStage.elapsedMs = Date.now() - (msgStage.startedAtMs ?? Date.now());
      msgStage.subtitle = msg;
      state.error = msg;
      state.outcome = "failed";
      repaint();
      return { status: "failed", failedStage: "message", error: msg };
    }

    if (signal.aborted) { await abortCleanup(); return cancelled(state); }

    // ------------------------------------------------------------------
    // Approval gate — skipped when --yolo or no awaitApproval wired.
    // Runs INSIDE the overlay; no ctx.ui.* calls here.
    // ------------------------------------------------------------------
    if (!options?.yolo && options?.awaitApproval) {
      state.awaitingApproval = true;
      repaint();
      const action = await options.awaitApproval();
      state.awaitingApproval = false;
      repaint();
      if (signal.aborted || action === "abort") {
        await abortCleanup();
        return cancelled(state);
      }
      if (action === "edit") {
        return { status: "edit-requested", message: state.message, stagedByExtension: extStaged };
      }
      if (action === "regenerate") continue;
      // action === "commit" → exit the loop
      break;
    } else {
      // --yolo or no gate wired: auto-commit after first generation
      break;
    }
  }

  // ------------------------------------------------------------------
  // Stage 4 — Create commit
  // Invariant: unreachable unless stages 1-3 are all "done".
  // ------------------------------------------------------------------
  const commitStage = getStage(state, "commit");
  commitStage.status = "in-progress";
  commitStage.startedAtMs = Date.now();
  commitStage.elapsedMs = undefined;
  repaint();

  try {
    const message = state.message!;
    const hash = await git.commit(pi, ctx.cwd, message, signal);

    if (signal.aborted) {
      commitStage.status = "todo";
      return cancelled(state);
    }

    state.commitHash = hash;
    commitStage.status = "done";
    commitStage.elapsedMs = Date.now() - (commitStage.startedAtMs ?? Date.now());
    commitStage.subtitle = `${hash}  ${message}`;
    state.outcome = "committed";
    repaint();
    return { status: "committed", commitHash: hash, message };

  } catch (err: unknown) {
    if (signal.aborted) {
      commitStage.status = "todo";
      return cancelled(state);
    }
    const msg = err instanceof Error ? err.message : String(err);
    commitStage.status = "failed";
    commitStage.elapsedMs = Date.now() - (commitStage.startedAtMs ?? Date.now());
    commitStage.subtitle = msg;
    state.error = msg;
    state.outcome = "failed";
    repaint();
    return { status: "failed", failedStage: "commit", error: msg };
  }
}
