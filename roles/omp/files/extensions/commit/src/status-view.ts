import type { ExtensionUiComponent, Theme } from "@oh-my-pi/pi-coding-agent";
import type { CommitState, CreateStatusView, GateAction } from "./types.ts";
import {
  stageIcon,
  SPINNER_FRAMES,
  visibleWidth,
  truncateVisible,
} from "./icons.ts";

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
): string {
  if (state.awaitingApproval) {
    const hint = "\u21b5 commit   e edit   esc abort";
    return theme.fg("dim", truncateVisible(hint, maxWidth));
  }
  if (!state.done) {
    return theme.fg("dim", truncateVisible("Esc to cancel", maxWidth));
  }

  const dismiss = " press any key to dismiss";
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
      stages: state.stages.map((s) => ({ status: s.status, subtitle: s.subtitle })),
      done: state.done,
      outcome: state.outcome,
      awaitingApproval: state.awaitingApproval,
      frame: frameIdx,
      width,
    });

    if (sig === cachedSig) return cachedLines;

    // inner width = area between borders MINUS the "  " (2-char) row indent
    // Box structure per line: │ content(width-2 total) │
    // innerWidth is the budget for content AFTER the "  " prefix
    const innerWidth = Math.max(0, width - 4); // (width-2) content - 2 leading spaces
    const contentWidth = Math.max(0, width - 2); // full area between the borders
    const box = theme.boxRound;
    const borderV = theme.fg("borderMuted", box.vertical);
    const frame = SPINNER_FRAMES[frameIdx];

    const lines: string[] = [];

    // ── Top border with "commit" title ──────────────────────────────────────
    // ╭─ commit ──...──╮
    // leftPart(3) + title(6) + rightPart(N+2) = width  →  N = width - 11
    const titleText = theme.bold(theme.fg("accent", "commit"));
    const rightDashes = Math.max(0, width - 11);
    lines.push(
      theme.fg("borderMuted", box.topLeft + box.horizontal + " ") +
        titleText +
        theme.fg("borderMuted", " " + box.horizontal.repeat(rightDashes) + box.topRight),
    );

    // ── Stage rows ───────────────────────────────────────────────────────────
    // Row: "  " + icon + " " + label + optional(" — " + subtitle) + trailing
    // Total content between │..│ = width - 2 chars
    for (const stage of state.stages) {
      const icon = stageIcon(theme, stage.status, frame);
      const isActive = stage.status === "in-progress";
      const isFailed = stage.status === "failed";

      const labelW = visibleWidth(stage.label);
      // Chars already consumed in the innerWidth budget (after "  "):
      //   icon(1) + " "(1) + label(labelW) = 2 + labelW
      // Separator " — " costs 3; subtitle gets the rest
      const subtitleBudget = Math.max(0, innerWidth - (2 + labelW) - 3);

      const styledLabel = isActive
        ? theme.bold(theme.fg("text", stage.label))
        : theme.fg("text", stage.label);

      let rowStr = "  " + icon + " " + styledLabel;
      // Track raw visible width for trailing-space calculation
      let rowRawW = 2 + 1 + 1 + labelW; // "  " + icon(1) + " " + label

      if (stage.subtitle && subtitleBudget > 0) {
        const truncSub = truncateVisible(stage.subtitle, subtitleBudget);
        rowStr +=
          " — " +
          (isFailed ? theme.fg("error", truncSub) : theme.fg("muted", truncSub));
        rowRawW += 3 + visibleWidth(truncSub);
      }

      // Pad to fill the full content area between borders (width - 2 chars total)
      const trailing = Math.max(0, contentWidth - rowRawW);
      lines.push(borderV + rowStr + " ".repeat(trailing) + borderV);
    }

    // ── Blank separator row ──────────────────────────────────────────────────
    lines.push(borderV + " ".repeat(contentWidth) + borderV);

    // ── Footer hint row ──────────────────────────────────────────────────────
    // Layout: │ + "  " + footerText + trailing + │
    // footerText max visible = (width - 2) - 2 = width - 4 = innerWidth
    const footerStyled = buildFooter(state, innerWidth, theme);
    const footerVW = visibleWidth(footerStyled);
    const footerTrailing = Math.max(0, innerWidth - footerVW);
    lines.push(borderV + "  " + footerStyled + " ".repeat(footerTrailing) + borderV);

    // ── Bottom border ────────────────────────────────────────────────────────
    lines.push(
      theme.fg(
        "borderMuted",
        box.bottomLeft + box.horizontal.repeat(contentWidth) + box.bottomRight,
      ),
    );

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
        else if (keybindings.matches(data, "app.interrupt") || data === "\x03") onApproval("abort");
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
