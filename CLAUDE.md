# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read [`CONSTRAINTS.md`](./CONSTRAINTS.md) before starting work.** It's the enforced quality/security bar (types, lint, format, IPC/vault boundary, secrets/vuln scanning status, speed budget). Never weaken a rule in it to make a change pass — fix the change, or edit CONSTRAINTS.md in its own commit with a stated reason.

## What This Project Is

**Notvex** is a cross-platform Electron desktop app for secure, fully-local encrypted notes. All data lives in a single SQLCipher-encrypted SQLite database — no account, no server, no network. Core crypto stack: Argon2id (KDF), XChaCha20-Poly1305 (note encryption), SQLCipher (AES-256 database), BIP39 recovery key, optional key-file second factor.

## Commands

```bash
pnpm dev            # Start Electron + Vite dev server
pnpm build          # Production build (all processes)
pnpm build:win      # Windows installer
pnpm build:mac      # macOS installer
pnpm build:linux    # Linux installer
pnpm typecheck      # Type-check main + preload + renderer
pnpm lint           # ESLint (zero warnings allowed)
pnpm lint:fix       # ESLint with auto-fix
pnpm format         # Prettier format (TS, CSS, JSON)
pnpm format:check   # Check formatting without writing
pnpm validate       # typecheck + lint + format:check
pnpm depcruise      # IPC/vault boundary check (.dependency-cruiser.cjs)
pnpm test:vault     # Vitest, all tests
pnpm test:coverage  # Vitest with coverage
pnpm doctor         # react-doctor scan (doctor:staged for staged files only)
pnpm check:fast     # typecheck + lint — edit loop
pnpm check:task     # validate + depcruise + test:vault — run before calling work done
pnpm check:full     # check:task + coverage — review/CI
```

`pnpm check:task` is the before-done gate. Gate tiers, speed budget and coverage floor are in [`CONSTRAINTS.md`](./CONSTRAINTS.md).

## Architecture

The project uses electron-vite with three separate build targets. Directories are described by responsibility — read the tree for their current contents.

**`src/main/`** — Electron main process (Node.js backend)
- `index.ts` — Entry point: app lifecycle (single-instance lock, `.nvx` file association), delegates window creation to `window.ts`
- `window.ts` — Creates the `BrowserWindow` (`contextIsolation`/`nodeIntegration` config lives here), applies `setContentProtection`, triggers vault lock on suspend/lock-screen/blur/minimize
- `ipc-handlers.ts` — Defines all IPC handlers; the only communication bridge to the renderer
- `vault/` — All cryptographic operations and vault orchestration (KDF, memory locking, BIP39 recovery, key container, backups)
- `db/` — SQLite/SQLCipher queries and schema migrations
- Remaining top-level modules are single-purpose main-process services (prefs, updater, file opening, clipboard, renderer/URL guards)

**`src/preload/index.ts`** — Exposes `window.notvex` API surface to the renderer via `contextBridge`. Any new IPC channel must be declared here.

**`src/renderer/src/`** — React 19 frontend
- `views/` — Top-level screens (setup, unlock, main app, post-recovery reset)
- `components/` — Feature components, grouped into subfolders by feature; `components/ui/` holds shadcn/ui primitives (see UI Rules)
- `hooks/` — Custom React hooks
- `store/` — Zustand stores (vault state, UI state, preferences)
- `lib/ipc.ts` — Typed IPC client (renderer side); the renderer's only route to main
- `lib/` — Other renderer utilities, including the CodeMirror 6 markdown editor (`lib/editor/`)

**`src/shared/types.ts`** — TypeScript types shared across all three processes.

**`tests/`** — Vitest tests: `tests/*.test.ts` run in node, `tests/renderer/*.test.ts` in jsdom. Never colocate tests in `src/`. Placement and typecheck rules: [`CONSTRAINTS.md` § Test file location](./CONSTRAINTS.md#test-file-location).

### IPC Pattern

All renderer↔main communication goes through IPC:
1. Define handler in `src/main/ipc-handlers.ts`
2. Expose channel in `src/preload/index.ts` via `contextBridge`
3. Call from renderer via `src/renderer/src/lib/ipc.ts`

### Vault Files on Disk

- `vault.nvx` — SQLCipher-encrypted SQLite database (notes + tags) with metadata, recovery-key-encrypted master key, salt, settings
- `userData/vault-backups/<sha256 of vault path>/` — copies of a vault taken before a header/schema migration; the newest 3 per vault are kept (`vault/backups.ts`)

---

## Code Style

- **Prettier:** no semicolons, single quotes, 2-space indent, 100-char line width, `prettier-plugin-tailwindcss` for class ordering
- **Path aliases:** `@/*` → `src/renderer/src/*` in the renderer; `@main/*` → `src/main/*` in the main process; `@shared/*` -> `src/shared/*`
- **Tailwind CSS 4** — config lives in CSS (`src/renderer/src/assets/main.css`), not `tailwind.config.js`
- **No `any` in TypeScript** — use `unknown` with narrowing or proper types
- **File naming:** React components in PascalCase (`NoteEditor.tsx`), everything else in kebab-case (`ipc-handlers.ts`, `vault.store.ts`)
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `chore:`, etc.), lowercase subject, max 72 chars

---

## UI Rules — read before writing any component or style

### 1. Never use raw HTML elements — always check for an existing component first

Before writing any `<button>`, `<input>`, `<dialog>`, `<select>`, or any other 
interactive element, follow this order:

**Step 1 — Check `src/renderer/src/components/ui/`**
List the folder first — its contents change with every `shadcn add`, so don't rely on
memory. If a component exists there that covers the use case, use it. Do not reimplement it.

None of the items in this folder can be changed without the user's prior confirmation.

**Step 2 — If not in `components/ui/`, check shadcn/ui via MCP**
Use the installed shadcn MCP to search if shadcn/ui has a component for the use case.
If it does, **stop and ask** before adding it:
> "shadcn/ui has a `<ComponentName>` component that covers this. Should I add it with 
> `npx shadcn@latest add <component>`?"

Do not add shadcn components without explicit approval.

**Step 3 — Only if neither exists, build a custom component**
Place it in `src/renderer/src/components/` (not in `components/ui/` — that folder 
is reserved for shadcn primitives).

### 2. Never hardcode colors — use CSS variables from main.css

All colors are defined as CSS custom properties in `src/renderer/src/assets/main.css`.
Always use Tailwind semantic tokens that map to those variables.

```
✅ Correct — semantic tokens
bg-background       text-foreground
bg-card             text-card-foreground
bg-popover          text-popover-foreground
bg-primary          text-primary-foreground
bg-secondary        text-secondary-foreground
bg-muted            text-muted-foreground
bg-accent           text-accent-foreground
bg-destructive      text-destructive-foreground
border-border
ring-ring

❌ Wrong — never use these
bg-[#121212]        text-[#ffffff]
bg-zinc-900         text-zinc-100
bg-neutral-800      border-gray-700
```

If a color in main.css doesn't have a Tailwind token mapped, add the mapping 
in main.css rather than hardcoding the hex value.

### 3. Dark mode only

Notvex has no light mode. Do not add `dark:` variants — all styles apply to 
dark mode by default. Do not add any light/dark toggle logic.

### 4. No inline styles

Never use the `style` prop for colors, spacing, or layout. All styling goes 
through Tailwind classes using the tokens above.

---

## Security Rules — never violate these

### Crypto and vault
- The renderer **never** imports or calls crypto functions directly
- The renderer **never** imports `@journeyapps/sqlcipher`, `libsodium-wrappers-sumo`, or any vault module
- All crypto and DB operations go through IPC → `ipc-handlers.ts` → vault/db modules
- The master key lives only in the main process memory (`sodium.malloc`), never in the renderer

### Memory
- Use `sodium.memzero` on any decrypted buffer when it goes out of scope
- The Zustand store never holds decrypted note content — only decrypted titles (needed for the sidebar list)
- Decrypted note content lives only in the active editor's local React state
- On vault lock: clear all decrypted content from memory before navigating to Unlock

### IPC
- `contextIsolation: true` and `nodeIntegration: false` — never change these
- Every IPC handler returns `{ success: true, data }` or `{ success: false, error: string }`
- Never let exceptions propagate unhandled from main to renderer

### Content protection
- `mainWindow.setContentProtection(true)` unless `allowScreenCapture` is `true` in `prefs.json`
- Never load remote URLs in any BrowserWindow

---

## Adding New Features — checklist

1. **IPC first:** define the handler in `ipc-handlers.ts` and expose it in `preload/index.ts` before touching the renderer
2. **Types in `shared/types.ts`:** any type used across processes goes there
3. **Check `components/ui/`** before building any UI element (see UI Rules above)
4. **Use semantic color tokens** — no hardcoded colors (see UI Rules above)
5. **Optimistic updates:** UI updates immediately, IPC call follows, revert + toast on error
6. **`sodium.memzero`** on any sensitive buffer when done with it
7. **Run `pnpm check:task`** before considering any feature complete