# AGENTS.md — Authoring oh-my-pi (omp) extensions

Dense reference for LLM agents building/maintaining omp extensions. Pinned to **omp v16.3.0** (see `roles/omp/defaults/main.yml`). Verify against live docs before relying on any signature.

## How to use this file
1. Skim the **Golden rules** + **API cheat-sheet** below.
2. For any detail, `read` the exact `omp://` doc in the **Doc map** — those ship with the installed version and are authoritative.
3. For exact TS types/signatures, `read` upstream `can1357/oh-my-pi` at tag `v16.3.0` (paths in **Source map**). Treat pi-tui widget signatures here as *summaries* — confirm before use.

## Doc map (read on demand)
| Need | Doc |
|---|---|
| Core API, events, ctx, tools | `omp://extensions.md` |
| Discovery/load order/lifecycle | `omp://extension-loading.md` |
| Tool authoring contract | `omp://custom-tools.md` |
| Hooks + return contracts | `omp://hooks.md`, `omp://skills/authoring-hooks.md` |
| Slash commands | `omp://slash-command-internals.md` |
| Authoring walkthrough | `omp://skills/authoring-extensions.md` |
| Minimal example | `omp://skills/examples/hello-extension/README.md`, `omp://skills/examples/safety-hook/README.md` |
| TUI render model | `omp://tui.md`, `omp://tui-core-renderer.md`, `omp://tui-runtime-internals.md` |
| Theme tokens | `omp://theme.md` |
| Keybindings/actions | `omp://keybindings.md` |
| Marketplace + install | `omp://marketplace.md`, `omp://skills/authoring-marketplaces.md` |
| Plugin state/files | `omp://plugin-manager-installer-plumbing.md` |
| Settings/config/secrets | `omp://settings.md`, `omp://config-usage.md`, `omp://secrets.md` |
| SDK/credentials | `omp://sdk.md` |

## Source map (upstream, tag v16.3.0, `can1357/oh-my-pi`)
- `packages/tui/src/tui.ts` — `Component`, renderer, `CURSOR_MARKER`, `Focusable`
- `packages/tui/src/components/*.ts` — Text, Box, SelectList, Input, Loader, ScrollView, TabBar, Markdown, Image, Spacer
- `packages/tui/src/utils.ts` — `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, `replaceTabs`
- `packages/tui/src/keys.ts` — `matchesKey`, `Key`, `isKeyRelease`, Kitty protocol
- `packages/coding-agent/src/extensibility/extensions/types.ts` — `ExtensionUIContext.custom`, mount points
- `packages/coding-agent/src/modes/theme/theme.ts` — `Theme`, `theme.fg/bg/fgBg`, `getSelectListTheme`/`getMarkdownTheme`/`getEditorTheme`
- `packages/coding-agent/src/modes/components/*.ts` — reference for native look (`transcript-container.ts`, `tool-execution.ts`, `custom-editor.ts`)

## Golden rules
1. **Register at load, act at runtime.** The factory runs once; only call `pi.register*`/`pi.on`/`pi.setLabel` there. Runtime actions (`pi.sendMessage`, `pi.setActiveToolsByName`, …) throw `ExtensionRuntimeNotInitializedError` during load — call them from handlers/tools/commands.
2. **Prefer built-in UI (`ctx.ui.*`) over custom pi-tui components.** Custom UI only when helpers can't express it.
3. **Never hardcode color/ANSI.** Style only via `theme.fg/bg/fgBg` + `theme.getSymbol`. This is what "seamless" means.
4. **Match keybindings by action, not raw key** (`keybindings.matches(data,"app.interrupt")`); respects user remaps + avoids reserved chords.
5. **Width-safe rendering.** `render(width)` must fit `width`; measure with `visibleWidth`, cut with `truncateToWidth`/`wrapTextWithAnsi` — never `.length`.
6. **Return the same array reference from `render` when content is unchanged** (renderer memoization); a fresh array only when it changed.
7. **Guard runtime UI:** check `ctx.hasUI` before `ctx.ui.custom`/dialogs.
8. **Honor `AbortSignal`** in tools; implement `dispose()` in components to free timers/loaders.
9. **Marketplace installs do NOT load extension modules** — only skills/commands/hooks/tools/MCP. Extension code loads from npm packages, `omp plugin link`, or the `.omp/extensions` dirs.

## Extension shape
```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
export default function ext(pi: ExtensionAPI) {
  pi.setLabel("My Ext");
  pi.registerTool({ /* ... */ });
  pi.registerCommand("cmd", { /* ... */ });
  pi.on("tool_call", async (ev, ctx) => { /* ... */ });
}
```
Manifest (`package.json`): entry via `omp.extensions` (legacy `pi.extensions` ok); multiple entries allowed. Dir fallback resolution: `package.json`→`omp.extensions` → `index.ts` → `index.js`.
```json
{ "name": "my-ext", "version": "0.0.1", "omp": { "extensions": ["./index.ts"] } }
```

## Discovery & load order (dedup by absolute path, first wins)
1. `<cwd>/.omp/extensions/`, `~/.omp/agent/extensions/` (native auto)
2. JS/TS hook factories
3. npm plugins in `~/.omp/plugins/node_modules` via `omp.extensions`
4. Explicit: CLI `omp --extension ./path` (`-e`) | `extensions:` in `~/.omp/agent/config.yml` or `<cwd>/.omp/config.yml`

Lifecycle: import+factory (register) → `ExtensionRunner.initialize` (wire runtime) → session/turn/tool events → handlers (runtime actions valid).

## API cheat-sheet (`pi: ExtensionAPI`)
**Register (load):**
- `on(event, (ev, ctx) => Promise<result|void>)`
- `registerTool(def)` · `registerCommand(name, {description, handler})`
- `registerShortcut(chord, handler)` · `registerFlag(flag, def)`
- `registerMessageRenderer(type, (msg,opts,theme)=>Component)`
- `registerAssistantThinkingRenderer((ctx,theme)=>Component)`
- `registerProvider(def)` · `setLabel(str)`

**Runtime actions:**
- `sendMessage(msg, {deliverAs:"steer"|"followUp"|"nextTurn", triggerTurn?})`
- `sendUserMessage(content, {deliverAs?})` · `appendEntry(type, data)` (durable state)
- `exec(cmd,args?,opts?)` · `getFlag(f)` · `getActiveToolNames()` / `getAllToolNames()` / `setActiveToolsByName(names)`
- `getSessionName()` / `setSessionName(n)` · `setModel(m)` · `getThinkingLevel()` / `setThinkingLevel(l)`

**Injected:** `pi.zod` (Zod v4 — use for tool params), `pi.typebox`, `pi.logger`, `pi.pi`, `pi.events`.

**`ctx` (all handlers/tools):** `cwd`, `hasUI`, `sessionManager`, `modelRegistry`, `model`, `models.{list,current,resolve}`, `getContextUsage()`, `compact()`, `isIdle()`, `hasPendingMessages()`, `abort()`, `shutdown()`, `getSystemPrompt()`, `memory?`.
**`ctx.ui`:** `notify(msg,type?)`, `confirm(title,msg)`, `select(title,opts)`, `input(title,ph?)`, `editor(title,prefill?)`, `setStatus(k,txt)`, `setTitle`, `setWorkingMessage`, `setWidget("aboveEditor"|"belowEditor",lines)`, `custom(factory,opts?)`, `getEditorText`/`setEditorText`.
**Command ctx (extra):** `waitForIdle()`, `newSession(opts?)`, `switchSession(path)`, `branch(entryId)`, `navigateTree(id,opts?)`, `reload()`.

## Tools (`omp://custom-tools.md`)
```ts
pi.registerTool({
  name, label, description,
  parameters: pi.zod.object({ q: pi.zod.string().describe("…") }),
  approval: "prompt",            // "allow"|"deny"|"prompt"
  hidden?, defaultInactive?, deferrable?, formatApprovalDetails?,
  renderCall?(args,opts,theme), renderResult?(res,opts,theme,args),  // on-theme UI
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    if (signal?.aborted) return { content:[{type:"text",text:"Cancelled"}] };
    onUpdate?.({ content:[{type:"text",text:"…"}], details:{phase:"x"} });  // streaming
    return { content:[{type:"text",text:"…"}], details:{}, isError:false };
  },
});
```
- Return `AgentToolResult{ content[], details?, isError? }`; content types: `text|image|image_link|document|artifact`.
- Throwing → `isError:true`. `details` = structured, survives in history.

## Hooks (`pi.on`) — control-bearing events
| Event | Return to affect | Effect |
|---|---|---|
| `tool_call` | `{block:true, reason}` | veto tool (fail-closed; throw also blocks; first block wins) |
| `tool_result` | `{content?, details?, isError?}` | rewrite LLM-visible output (last override wins) |
| `context` | `{messages}` | rewrite message list before each LLM call |
| `session_before_switch/branch/compact/tree` | `{cancel:true}` | veto op |
| `before_agent_start` | `{message?}` | inject |
| `session_stop` | `{continue?}` \| `{decision:"block",reason}` | gate settle |
| `user_bash` / `user_python` | `{result}` | intercept |

Observability (no return): `turn_start/end`, `message_start/update/end`, `agent_start/end`, `tool_execution_start/update/end`, `tool_approval_requested/resolved`, `auto_compaction_*`, `auto_retry_*`, `session_start/switch/branch/compact/tree/shutdown`. Full list: `omp://extensions.md`, `omp://hooks.md`.

## Slash commands
```ts
pi.registerCommand("hello", {
  description: "…",
  handler: async (args, ctx) => { /* args = raw text after /hello */ },
});
```
Name conflicts with built-ins are skipped (diagnostic). Detail: `omp://slash-command-internals.md`.

## UI tier 1 — built-in helpers (default choice)
Use `ctx.ui.notify/confirm/select/input/editor/setStatus/setTitle/setWorkingMessage/setWidget`. Native look, zero styling. Only escalate to tier 2 when these can't express the interaction.

## UI tier 2 — custom pi-tui component
Mount seam (`packages/.../extensions/types.ts`, `omp://tui.md`):
```ts
const r = await ctx.ui.custom<T>(
  (tui, theme, keybindings, done) => component,   // done(result) resolves + disposes
  { overlay: true }   // true=bottom-centered overlay; false=replaces editor (state saved/restored)
);
```
`Component` contract (`packages/tui/src/tui.ts`):
```ts
interface Component {
  render(width: number): readonly string[];  // fit width; same ref if unchanged
  handleInput?(data: string): void;          // when focused
  invalidate?(): void; dispose?(): void; wantsKeyRelease?: boolean;
}
```
Widgets (`packages/tui/src/components/`, verify signatures): `Text`, `Box` (+`BoxBorder`), `SelectList`, `Input`, `Loader`/`CancellableLoader`, `ScrollView`, `TabBar`, `Markdown`, `Image`, `Spacer`. Layout is constraint-based: only input is `width`; height = #lines; spacing via padding params (no flex).
Utils (`packages/tui/src/utils.ts`): `visibleWidth`, `truncateToWidth(text,max,ellipsis?,pad?)`, `wrapTextWithAnsi(text,width)`, `replaceTabs`, `padding(n)`.
Cursor: emit `CURSOR_MARKER` in rendered text at cursor position (engine extracts/positions).

## Theming (`omp://theme.md`, `theme.ts`)
- `theme.fg(token)` / `theme.bg(token)` / `theme.fgBg(fg,bg)` → `(text)=>string`; `theme.getSymbol(key)`; `theme.getColor(token)`.
- Inherit native styling: `getSelectListTheme(theme)`, `getMarkdownTheme(theme)`, `getEditorTheme(theme)`.
- Common tokens: `accent`, `text`, `muted`, `dim`, `border`/`borderAccent`/`borderMuted`, `success`/`error`/`warning`, `selectedBg`, `userMessageBg`/`customMessageBg`, `toolPendingBg`/`toolSuccessBg`/`toolErrorBg`, `statusLineBg`; markdown `md*`, syntax `syntax*`, diff `toolDiff*`, `thinking*`.

## Keybindings (`omp://keybindings.md`, `keys.ts`)
- Action match: `keybindings.matches(data,"app.interrupt")` (Esc/cancel), `"app.message.followUp"` (confirm), `"app.clipboard.pasteImage"`, `"app.display.reset"`.
- Raw match: `matchesKey(data,"ctrl+c")`; `Key.escape/enter/tab`, `Key.ctrl("c")`, `Key.ctrlShift("p")`, `Key.alt("m")`.
- Reserved (register ignored): `ctrl+c/d/z/k/p/l/o/t/g/q`, `alt+m`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter`.
- Convention: Esc=cancel, Enter=confirm, arrows=navigate.

## UX best practices (seamless)
- Resize: `render(width)` re-called on resize — cache by width, invalidate on change.
- Render explicit loading / empty / error states (spinner `Loader` in `accent`; hints in `muted`/`dim`).
- Legibility: body `text`, secondary `muted`, highlight `accent`; test at ~60 cols.
- Mirror built-ins in `modes/components/` for native feel; use `Markdown` widget for rich text; `Box`+theme border for framing.

## Config & secrets
- Settings: `~/.omp/agent/config.yml` / `<cwd>/.omp/config.yml`; read via `ctx.settings?.get(key)` when present; `process.env` for overrides; durable state via `pi.appendEntry` + rebuild from `ctx.sessionManager.getBranch()` on `session_start/branch/tree`.
- Credentials resolved by host (see `omp://sdk.md`): CLI `--api-key` → config `apiKey` → stored → OAuth → env → provider resolver. Extension reads model/creds via `ctx.model`/`ctx.modelRegistry`; secrets doc: `omp://secrets.md`.
- Precedence: built-in < global < project < CLI < runtime. Array settings (e.g. `extensions`) REPLACE, not append.

## Packaging & distribution (`omp://marketplace.md`)
- Marketplace = git repo with `.omp-plugin/marketplace.json` (or `.claude-plugin/marketplace.json`). Required: `name`, `owner.name`, `plugins[]`.
- Plugin dir ships: `skills/<n>/SKILL.md`, `commands/*.md`, `agents/*.md`, `hooks/pre|post/`, `tools/`, `.mcp.json`, `package.json`, `README.md`.
- Plugin name: lowercase alnum/hyphen/dot, ≤64, alnum ends.
- Install: `omp plugin marketplace add owner/repo` · `omp plugin install [--scope user|project] name@marketplace` · `enable`/`disable`/`uninstall`. In-session `/marketplace …`, `/plugins …`. Test local: `/marketplace add ./path`.
- Key files: `~/.omp/plugins/{installed_plugins.json,omp-plugins.lock.json}`, `~/.omp/marketplaces.json`, `<cwd>/.omp/plugin-overrides.json`.

## Install for local dev
- Drop dir in `~/.omp/agent/extensions/<name>/`, or add path to `config.yml#extensions`, or `omp --extension ./<name>` (one-shot), or `omp plugin link`.

## Gotchas
- Runtime action during load → throws. · `tool_call` throw = block (fail-closed). · Command name clash = silently skipped. · Reserved shortcuts ignored. · Array settings replace globally. · Marketplace ≠ extension modules. · Dedup by absolute path (auto-discovery wins over explicit). · No sandbox — extension runs in-process with full host access.

## Verification note
Extension-API signatures here derive from `omp://` docs (version-matched, high confidence). pi-tui widget signatures are summaries reconstructed against upstream v16.3.0 — for anything beyond `Component`, `Text`, `Box`, `SelectList`, `Input`, `theme.fg/bg`, and `ctx.ui.custom`, `read` the real source in **Source map** before relying on exact props.
