import type { ExtensionAPI, AgentToolResult } from "@oh-my-pi/pi-coding-agent";
import type { CommitResult, GateAction } from "./src/types.ts";
import { isGitRepo, commit, unstageFiles } from "./src/git.ts";
import { createInitialState, runCommitWorkflow } from "./src/workflow.ts";
import { createStatusView } from "./src/status-view.ts";

function toCommitToolResult(r: CommitResult): AgentToolResult {
  switch (r.status) {
    case "committed":
      return {
        content: [{ type: "text", text: `Committed ${r.commitHash}: ${r.message}` }],
        details: { commitHash: r.commitHash, message: r.message },
      };
    case "clean":
      return {
        content: [{ type: "text", text: "Nothing to commit — working tree clean." }],
        details: { clean: true },
      };
    case "cancelled":
      return {
        content: [{ type: "text", text: "Commit cancelled before completion." }],
        details: { cancelled: true },
      };
    default:
      return {
        content: [{ type: "text", text: `Commit failed: ${r.error ?? "unknown error"}` }],
        isError: true,
        details: { error: r.error, failedStage: r.failedStage },
      };
  }
}

export default function activate(pi: ExtensionAPI): void {
  pi.setLabel("commit");
  pi.registerCommand("commit", {
    description:
      "Stage on-topic changes, scan for secrets, and commit with an AI-generated message (use --yolo to skip the review step)",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/commit requires an interactive session", "error");
        return;
      }
      if (!(await isGitRepo(pi, ctx.cwd))) {
        ctx.ui.notify("Not inside a git repository", "error");
        return;
      }

      // Parse --yolo flag; remainder becomes the topic hint for file selection.
      const raw = _args.trim();
      const tokens = raw.split(/\s+/).filter(Boolean);
      const yolo = tokens.includes("--yolo");
      const hint = tokens.filter((t) => t !== "--yolo").join(" ");

      const state = createInitialState();
      const controller = new AbortController();

      // Approval-gate wiring.
      // awaitApproval() is called by the workflow when it reaches the gate; it
      // creates a Promise and stores the resolver so the overlay's onApproval
      // callback can fulfil it when the user acts.
      let resolveApproval: (a: GateAction) => void = () => {};

      const result = await ctx.ui.custom<CommitResult>(
        (tui, theme, keybindings, done) => {
          const view = createStatusView(
            tui,
            theme,
            keybindings,
            () => state,
            () => controller.abort(),               // onInterrupt: Esc / ctrl+c while running
            () => done(finalResult),                 // onDismiss: any key once state.done
            (action) => resolveApproval(action),     // onApproval: in-overlay gate decision
          );
          const repaint = () => tui.requestComponentRender(view);

          let finalResult: CommitResult = { status: "cancelled" };

          void runCommitWorkflow(pi, ctx, state, repaint, controller.signal, {
            hint,
            yolo,
            // Each call creates a fresh Promise and binds the resolver so that
            // onApproval (above) can fulfil it from the overlay.
            awaitApproval: () => new Promise<GateAction>((r) => { resolveApproval = r; }),
          })
            .then((res) => {
              finalResult = res;
            })
            .catch((err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              finalResult = { status: "failed", error: errMsg };
              state.error = errMsg;
              state.outcome = "failed";
            })
            .finally(() => {
              if (finalResult.status === "edit-requested") {
                // Auto-close the overlay immediately; real editor opens after.
                done(finalResult);
              } else {
                // Mark done so the view renders a final banner; user dismisses.
                state.done = true;
                repaint();
              }
            });

          return view;
        },
        { overlay: true },
      );

      // edit-requested: overlay is already gone; open real top-level editor.
      // (Constraint: no ctx.ui.* calls inside the overlay/workflow — safe here.)
      if (result.status === "edit-requested") {
        const prefill = result.message ?? "";
        // Default (hook) mode: Ctrl+Enter or Ctrl+Q submits; Esc cancels.
        const edited = await ctx.ui.editor(
          "Review commit message — Ctrl+Enter/Ctrl+Q to commit, Esc to abort",
          prefill,
        );
        if (edited === undefined) {
          if (result.stagedByExtension?.length) {
            try { await unstageFiles(pi, ctx.cwd, result.stagedByExtension); } catch {}
          }
          ctx.ui.notify("Commit cancelled", "warning");
          return;
        }
        const finalMsg = edited.trim();
        if (!finalMsg) {
          if (result.stagedByExtension?.length) {
            try { await unstageFiles(pi, ctx.cwd, result.stagedByExtension); } catch {}
          }
          ctx.ui.notify("Empty message — commit aborted", "warning");
          return;
        }
        try {
          const hash = await commit(pi, ctx.cwd, finalMsg);
          ctx.ui.notify(`Committed ${hash}: ${finalMsg}`, "info");
        } catch (err: unknown) {
          ctx.ui.notify(`Commit failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }

      if (result.status === "committed") {
        ctx.ui.notify(`Committed ${result.commitHash}: ${result.message}`, "info");
      } else if (result.status === "failed") {
        ctx.ui.notify(`Commit aborted: ${result.error}`, "error");
      } else if (result.status === "cancelled") {
        ctx.ui.notify("Commit cancelled", "warning");
      } else {
        ctx.ui.notify("Nothing to commit — working tree clean", "info");
      }
    },
  });

  pi.registerTool({
    name: "commit",
    label: "Commit",
    description:
      "Autonomously create a git commit: stage the on-topic files for one logical change, scan the staged changes for secrets with gitleaks, generate a Conventional Commits message with the pi/commit model, and commit — in a single pass. Shows the user a live status overlay when an interactive UI is present; never prompts the user for a decision. Use when committing work programmatically.",
    approval: "write",
    parameters: pi.typebox.Type.Object({
      hint: pi.typebox.Type.Optional(
        pi.typebox.Type.String({
          description: "Optional short description of the logical change, to guide on-topic file selection.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult> {
      if (!(await isGitRepo(pi, ctx.cwd))) {
        return { content: [{ type: "text", text: "Not inside a git repository." }], isError: true };
      }
      const hint =
        typeof params === "object" && params !== null && "hint" in params && typeof params.hint === "string"
          ? params.hint.trim()
          : "";
      const controller = new AbortController();
      signal?.addEventListener("abort", () => controller.abort(), { once: true });
      if (signal?.aborted) controller.abort();
      const state = createInitialState();
      const run = (repaint: () => void) =>
        runCommitWorkflow(pi, ctx, state, repaint, controller.signal, { hint, yolo: true });

      let result: CommitResult;
      if (ctx.hasUI) {
        // Same overlay the /commit command mounts; the agent (not the user)
        // drives it, so there is no approval gate (yolo) and it auto-closes when done.
        result = await ctx.ui.custom<CommitResult>(
          (tui, theme, keybindings, done) => {
            let final: CommitResult = { status: "cancelled" };
            const view = createStatusView(
              tui,
              theme,
              keybindings,
              () => state,
              () => controller.abort(), // onInterrupt: a watching human may Esc to cancel
              () => done(final), // onDismiss
              () => {}, // onApproval: unused (yolo — no gate)
            );
            const repaint = () => tui.requestComponentRender(view);
            void run(repaint)
              .then((r) => {
                final = r;
              })
              .catch((err: unknown) => {
                const m = err instanceof Error ? err.message : String(err);
                final = { status: "failed", error: m };
                state.error = m;
                state.outcome = "failed";
              })
              .finally(() => {
                state.done = true;
                repaint();
                done(final); // auto-close; the agent isn't waiting on a keypress
              });
            return view;
          },
          { overlay: true },
        );
      } else {
        // No interactive UI (print/RPC): run headless with a no-op repaint.
        result = await run(() => {});
      }
      return toCommitToolResult(result);
    },
  });
}
