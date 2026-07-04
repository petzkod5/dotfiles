import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUiComponent,
  Theme,
  KeybindingsManager,
} from "@oh-my-pi/pi-coding-agent";
import type { TUI } from "@oh-my-pi/pi-tui";

export type StageId = "stage" | "scan" | "message" | "commit";
export type StageStatus = "todo" | "in-progress" | "done" | "failed";

/** Terminal workflow outcomes (drive the final banner). */
export type Outcome = "committed" | "failed" | "cancelled" | "clean";

/** Workflow result status. "edit-requested" is a non-terminal control signal:
 *  the overlay auto-closes and the handler hands off to the real editor. */
export type ResultStatus = Outcome | "edit-requested";

/** In-overlay approval-gate decision. */
export type GateAction = "commit" | "edit" | "abort";

export interface Stage {
  id: StageId;
  /** "Stage files" | "Scan for secrets" | "Generate message" | "Create commit" */
  label: string;
  status: StageStatus;
  /** Detail line shown after the label. */
  subtitle?: string;
}

export interface CommitState {
  /** ALWAYS length 4, ordered stage, scan, message, commit. */
  stages: Stage[];
  /** Workflow finished (terminal outcome reached). */
  done: boolean;
  /** Set once at completion; drives the final banner + dismissal. */
  outcome?: Outcome;
  /** Generated commit message, once produced (also the edit prefill). */
  message?: string;
  /** Short hash after a successful commit. */
  commitHash?: string;
  /** Human-readable failure reason (mirrored onto the failed stage subtitle). */
  error?: string;
  /** True while paused in the in-overlay approval gate (skipped with --yolo). */
  awaitingApproval: boolean;
}

export interface CommitResult {
  status: ResultStatus;
  failedStage?: StageId;
  message?: string;
  commitHash?: string;
  error?: string;
  /** Files this extension staged (excluding anything the user had pre-staged).
   *  Used by the handler to roll back staging if the editor step is cancelled. */
  stagedByExtension?: string[];
}

/** Extra, optional inputs to the workflow (kept off the positional seam). */
export interface WorkflowOptions {
  /** Topic hint from the /commit args (used for file selection). */
  hint?: string;
  /** --yolo: skip the approval gate and auto-commit. */
  yolo?: boolean;
  /** Resolves with the user's gate decision. Omitted (or yolo) => no gate. */
  awaitApproval?: () => Promise<GateAction>;
}

export type Repaint = () => void;

/** SEAM: implemented in src/workflow.ts */
export type RunCommitWorkflow = (
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: CommitState,
  repaint: Repaint,
  signal: AbortSignal,
  options?: WorkflowOptions,
) => Promise<CommitResult>;

/** SEAM: implemented in src/status-view.ts */
export type CreateStatusView = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  getState: () => CommitState,
  /** Esc / ctrl+c while the workflow is running (state.done === false). */
  onInterrupt: () => void,
  /** any key once state.done === true. */
  onDismiss: () => void,
  /** Approval-gate decision (only while state.awaitingApproval === true). */
  onApproval: (action: GateAction) => void,
) => ExtensionUiComponent;
