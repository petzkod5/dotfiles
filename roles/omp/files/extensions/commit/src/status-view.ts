import type { ExtensionUiComponent, Theme } from "@oh-my-pi/pi-coding-agent";
import type { CommitState, CreateStatusView, GateAction } from "./types.ts";
import {
  stageIcon,
  SPINNER_FRAMES,
  visibleWidth,
  truncateVisible,
} from "./icons.ts";

// ─── Elapsed-time formatter ───────────────────────────────────────────────────

/** Format a duration (ms) as a compact seconds string, e.g. "0.4s" or "1.2s". */
function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Footer builder ──────────────────────────────────────────────────────────

/**
 * Build the styled footer text, capped at `maxWidth` visible code points.
 * The "  " (2-space) indent that precedes this in the box is NOT included here;
 * callers subtract 2 from the available row budget before passing `maxWidth`.
 */
function buildFooter(
  state: CommitState,
  maxWidth: number,
  theme: Theme,
  interactive: boolean,
): string {
  if (state.awaitingApproval) {
    const hint = "\u21b5 commit  e edit  r regen  q abort";
    return theme.fg("dim", truncateVisible(hint, maxWidth));
  }
  if (!state.done) {
    return interactive ? theme.fg("dim", truncateVisible("Esc to cancel", maxWidth)) : "";
  }

  const dismiss = interactive ? " press any key to dismiss" : "";
  const dismissW = visibleWidth(dismiss);

  switch (state.outcome) {
    case "committed": {
      // symbol(1) + " committed HASH"(variable) + dismiss(fixed)
      const textRaw = ` committed ${state.commitHash ?? ""}`;
      const budget = Math.max(0, maxWidth - 1 - dismissW);
      const truncText = truncateVisible(textRaw, budget);
      return (
        theme.styledSymbol("status.success", "success") +
        theme.fg("success", truncText) +
        theme.fg("dim", dismiss)
      );
    }

    case "failed": {
      const textRaw = ` aborted: ${state.error ?? "unknown error"}`;
      const budget = Math.max(0, maxWidth - 1 - dismissW);
      const truncText = truncateVisible(textRaw, budget);
      return (
        theme.styledSymbol("status.error", "error") +
        theme.fg("error", truncText) +
        theme.fg("dim", dismiss)
      );
    }

    case "cancelled": {
      const textRaw = " cancelled";
      const availDismiss = Math.max(0, maxWidth - 1 - visibleWidth(textRaw));
      return (
        theme.styledSymbol("status.aborted", "warning") +
        theme.fg("warning", textRaw) +
        theme.fg("dim", truncateVisible(dismiss, availDismiss))
      );
    }

    case "clean": {
      const textRaw = " nothing to commit";
      const availDismiss = Math.max(0, maxWidth - 1 - visibleWidth(textRaw));
      return (
        theme.styledSymbol("status.info", "muted") +
        theme.fg("muted", textRaw) +
        theme.fg("dim", truncateVisible(dismiss, availDismiss))
      );
    }

    default:
      return theme.fg("dim", truncateVisible("done", maxWidth));
  }
}

// ─── Pure box renderer (shared by the overlay and the agent tool) ─────────────

/**
 * Produce the full set of styled, width-safe lines for the commit status box.
 * Pure — no caching, no timers. Shared by the interactive overlay
 * (createStatusView) and the agent tool's inline renderResult.
 * `frame` is a spinner frame counter (any integer); `interactive` toggles the
 * human-only footer hints ("Esc to cancel" / "press any key to dismiss").
 */
export function renderCommitBox(
  state: CommitState,
  theme: Theme,
  frame: number,
  width: number,
  interactive: boolean,
): readonly string[] {
  const innerWidth = Math.max(0, width - 4);
  const contentWidth = Math.max(0, width - 2);
  const box = theme.boxRound;
  const borderV = theme.fg("borderMuted", box.vertical);
  const n = SPINNER_FRAMES.length;
  const spinner = SPINNER_FRAMES[((frame % n) + n) % n];

  const lines: string[] = [];

  // Top border with "commit" title
  const titleText = theme.bold(theme.fg("accent", "commit"));
  const rightDashes = Math.max(0, width - 11);
  lines.push(
    theme.fg("borderMuted", box.topLeft + box.horizontal + " ") +
      titleText +
      theme.fg("borderMuted", " " + box.horizontal.repeat(rightDashes) + box.topRight),
  );

  // Stage rows
  for (const stage of state.stages) {
    const icon = stageIcon(theme, stage.status, spinner);
    const isActive = stage.status === "in-progress";
    const isFailed = stage.status === "failed";

    let timerStr = "";
    if (isActive && stage.startedAtMs != null) {
      timerStr = formatElapsed(Date.now() - stage.startedAtMs);
    } else if (stage.elapsedMs != null) {
      timerStr = formatElapsed(stage.elapsedMs);
    }
    const timerW = timerStr.length;
    const timerReserve = timerW > 0 ? 1 + timerW : 0;

    const labelW = visibleWidth(stage.label);
    const subtitleBudget = Math.max(0, innerWidth - (2 + labelW) - 3 - timerReserve);

    const styledLabel = isActive
      ? theme.bold(theme.fg("text", stage.label))
      : theme.fg("text", stage.label);

    let rowStr = "  " + icon + " " + styledLabel;
    let rowRawW = 2 + 1 + 1 + labelW;

    if (stage.subtitle && subtitleBudget > 0) {
      const truncSub = truncateVisible(stage.subtitle, subtitleBudget);
      rowStr +=
        " — " +
        (isFailed ? theme.fg("error", truncSub) : theme.fg("muted", truncSub));
      rowRawW += 3 + visibleWidth(truncSub);
    }

    if (timerW > 0) {
      rowStr += " " + theme.fg("dim", timerStr);
      rowRawW += 1 + timerW;
    }

    const trailing = Math.max(0, contentWidth - rowRawW);
    lines.push(borderV + rowStr + " ".repeat(trailing) + borderV);
  }

  // Blank separator row
  lines.push(borderV + " ".repeat(contentWidth) + borderV);

  // Usage footer (tokens + cost) — only when the model has been called
  if (state.usage.totalTokens > 0) {
    const usageText = `${state.usage.totalTokens.toLocaleString()} tok · $${state.usage.cost.toFixed(4)}`;
    const truncUsage = truncateVisible(usageText, innerWidth);
    const usageStyled = theme.fg("muted", truncUsage);
    const usageTrailing = Math.max(0, innerWidth - visibleWidth(truncUsage));
    lines.push(borderV + "  " + usageStyled + " ".repeat(usageTrailing) + borderV);
  }

  // Footer hint / final banner row
  const footerStyled = buildFooter(state, innerWidth, theme, interactive);
  const footerVW = visibleWidth(footerStyled);
  const footerTrailing = Math.max(0, innerWidth - footerVW);
  lines.push(borderV + "  " + footerStyled + " ".repeat(footerTrailing) + borderV);

  // Bottom border
  lines.push(
    theme.fg(
      "borderMuted",
      box.bottomLeft + box.horizontal.repeat(contentWidth) + box.bottomRight,
    ),
  );

  return lines;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export const createStatusView: CreateStatusView = (
  tui,
  theme,
  keybindings,
  getState,
  onInterrupt,
  onDismiss,
  onApproval,
) => {
  let frameIdx = 0;
  let cachedSig: string | null = null;
  let cachedLines: readonly string[] = [];

  // ── Render ────────────────────────────────────────────────────────────────

  function buildLines(width: number): readonly string[] {
    const state = getState();

    const sig = JSON.stringify({
      stages: state.stages.map((s) => ({ status: s.status, subtitle: s.subtitle, startedAtMs: s.startedAtMs, elapsedMs: s.elapsedMs })),
      done: state.done,
      outcome: state.outcome,
      awaitingApproval: state.awaitingApproval,
      frame: frameIdx,
      width,
      usageTotalTokens: state.usage.totalTokens,
      usageCost: state.usage.cost,
    });

    if (sig === cachedSig) return cachedLines;

    const lines = renderCommitBox(state, theme, frameIdx, width, true);
    cachedSig = sig;
    cachedLines = lines;
    return lines;
  }

  // ── Component object ──────────────────────────────────────────────────────

  let spinnerTimer: NodeJS.Timeout | null = null;

  const view: ExtensionUiComponent = {
    render(width: number): readonly string[] {
      return buildLines(width);
    },

    handleInput(data: string): void {
      const s = getState();
      if (s.done) { onDismiss(); return; }
      if (s.awaitingApproval) {
        if (data === "\r" || data === "\n") onApproval("commit");
        else if (data === "e" || data === "E") onApproval("edit");
        else if (data === "r" || data === "R") onApproval("regenerate");
        else if (data === "q" || data === "Q" || data === "\x1b" || keybindings.matches(data, "app.interrupt") || data === "\x03") onApproval("abort");
        return;
      }
      if (keybindings.matches(data, "app.interrupt") || data === "\x03") onInterrupt();
    },

    invalidate(): void {
      cachedSig = null;
    },

    dispose(): void {
      if (spinnerTimer !== null) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
    },
  };

  // ── Spinner ───────────────────────────────────────────────────────────────
  // Advance frame, repaint only while a stage is in-progress and workflow
  // is still running. Self-terminates once state.done becomes true.
  spinnerTimer = setInterval(() => {
    frameIdx = (frameIdx + 1) % SPINNER_FRAMES.length;
    const state = getState();
    if (!state.done && state.stages.some((s) => s.status === "in-progress")) {
      tui.requestComponentRender(view);
    }
    if (state.done && spinnerTimer !== null) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }, 80);

  return view;
};
