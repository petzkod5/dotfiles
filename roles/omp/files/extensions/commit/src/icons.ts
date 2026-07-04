import type { Theme } from "@oh-my-pi/pi-coding-agent";
import type { StageStatus } from "./types.ts";

// Braille dot spinner frames — matches nerd/unicode symbol preset (config.yml symbolPreset: nerd)
export const SPINNER_FRAMES: readonly string[] = [
  "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
];

/**
 * Returns a styled single-glyph icon for a stage status.
 * For "in-progress", pass the current spinner frame string.
 */
export function stageIcon(
  theme: Theme,
  status: StageStatus,
  spinnerFrame: string,
): string {
  switch (status) {
    case "todo":
      return theme.styledSymbol("status.pending", "dim");
    case "in-progress":
      return theme.fg("accent", spinnerFrame);
    case "done":
      return theme.styledSymbol("status.done", "success");
    case "failed":
      return theme.styledSymbol("status.error", "error");
  }
}

/**
 * Count the visible (terminal column) width of a string by stripping
 * ANSI SGR escape sequences and counting Unicode code points.
 * Does NOT handle wide (CJK / emoji) code points — all glyphs here are BMP.
 */
export function visibleWidth(s: string): number {
  return [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

/**
 * Truncate `s` to at most `max` visible code points.
 * If truncation occurs, the last visible position is replaced with "…".
 * Operates on the UNSTYLED (plain text) content — do not pass styled strings.
 */
export function truncateVisible(s: string, max: number): string {
  if (max <= 0) return "";
  // Strip ANSI (should be absent for unstyled input, but defensive)
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  const codePoints = [...stripped];
  if (codePoints.length <= max) return s;
  // Replace the last kept position with ellipsis
  return codePoints.slice(0, max - 1).join("") + "…";
}
