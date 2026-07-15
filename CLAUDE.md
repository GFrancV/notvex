# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**Notvex** is a cross-platform Electron desktop app for secure, fully-local encrypted notes. All data lives in a single SQLCipher-encrypted SQLite database — no account, no server, no network. Core crypto stack: Argon2id (KDF), XChaCha20-Poly1305 (note encryption), SQLCipher (AES-256 database), BIP39 recovery key, optional key-file second factor.

## Commands

```bash
pnpm dev          # Start Electron + Vite dev server
pnpm build        # Production build (all processes)
pnpm build:win    # Windows installer
pnpm build:mac    # macOS installer
pnpm build:linux  # Linux installer
pnpm typecheck    # Type-check main + preload + renderer
pnpm lint         # ESLint (zero warnings allowed)
pnpm lint:fix     # ESLint with auto-fix
pnpm format       # Prettier format (TS, CSS, JSON)
pnpm format:check # Check formatting without writing
pnpm validate     # typecheck + lint + format:check (run before committing)
```

## Architecture

The project uses electron-vite with three separate build targets:

**`src/main/`** — Electron main process (Node.js backend)
- `index.ts` — Entry point: app lifecycle (single-instance lock, `open-file`/`second-instance` handling for `.nvx` file association), delegates window creation to `window.ts`
- `window.ts` — Creates the `BrowserWindow` (`contextIsolation`/`nodeIntegration` config lives here), applies `setContentProtection`, and triggers vault lock on suspend/lock-screen/blur/minimize
- `vault/` — All cryptographic operations: key derivation (`crypto.ts`), memory locking (`memlock.ts`), BIP39 recovery (`recovery.ts`), key container (`container.ts`), vault orchestration (`vault.ts`)
- `db/` — SQLite/SQLCipher queries (`queries.ts`) and schema migrations (`migrations.ts`)
- `ipc-handlers.ts` — Defines all IPC handlers; the only communication bridge to the renderer
- `prefs.ts` — User preferences persisted as `prefs.json` in `app.getPath('userData')` via plain Node.js `fs` (no external library)
- `updater.ts` — electron-updater integration (check/download/install app updates)
- `file-opener.ts` — Resolves `.nvx` file paths passed via OS file association / second-instance argv

**`src/preload/index.ts`** — Exposes `window.notvex` API surface to the renderer via `contextBridge`. Any new IPC channel must be declared here.

**`src/renderer/src/`** — React 18 frontend
- `views/` — Top-level views: `setup.tsx` (vault creation), `unlock.tsx` (vault unlock), `main.tsx` (main notes app), `post-recovery-reset.tsx` (password reset after recovery)
- `components/` — Feature components; `components/ui/` holds shadcn/ui primitives. Standalone feature components live at the top level (`note-editor.tsx`, `note-list.tsx`, `note-reading-view.tsx`, `sidebar.tsx`, `command-palette.tsx`, `VaultSwitcher.tsx`, `security-settings-dialog.tsx`, `change-password-dialog.tsx`, `KeyFileInput.tsx`, `FeatureLockedByVersion.tsx`, `AppLogo.tsx`, `password-strength-bar.tsx`, `recovery-words-grid.tsx`, `editor-context-menu.tsx`), plus subfolders:
  - `editor/` — `EditorToolbar.tsx` (formatting toolbar for the CodeMirror editor)
  - `tags/` — `TagChip.tsx`, `TagCreateModal.tsx`, `TagDeleteModal.tsx`, `TagFilter.tsx`, `TagSelector.tsx`
  - `dialogs/` — `UpdateAvailableDialog.tsx`, `AppVersionDialog.tsx`
  - `settings/` — `KeyFileSetting.tsx`
- `hooks/` — Custom React hooks: `use-copy-to-clipboard.ts`, `use-create-note.ts`, `use-mobile.ts`, `use-vault-capabilities.ts`, `use-pick-vault.ts`
- `store/` — Zustand stores: `vault.store.ts` (vault state, notes, tags), `ui.store.ts` (UI state), `prefs.store.ts` (user preferences: auto-lock, key file, screen capture)
- `lib/ipc.ts` — Typed IPC client (renderer side)
- `lib/tag-colors.ts` — Centralized tag color definitions
- `lib/editor/` — CodeMirror 6 markdown editor with live preview (`live-preview.ts`) and formatting helpers (`formatting.ts`)

**`src/shared/types.ts`** — TypeScript types shared across all three processes.

### IPC Pattern

All renderer↔main communication goes through IPC:
1. Define handler in `src/main/ipc-handlers.ts`
2. Expose channel in `src/preload/index.ts` via `contextBridge`
3. Call from renderer via `src/renderer/src/lib/ipc.ts`

### Vault Files on Disk

- `vault.nvx` — SQLCipher-encrypted SQLite database (notes + tags) with metadata, recovery-key-encrypted master key, salt, settings

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
If a component exists there that covers the use case, use it. Do not reimplement it.

```
# Components currently in components/ui/:
alert.tsx         badge.tsx         button.tsx        checkbox.tsx
collapsible.tsx   command.tsx       context-menu.tsx  dialog.tsx
dropdown-menu.tsx field.tsx         input.tsx         input-group.tsx
kbd.tsx           label.tsx         popover.tsx       progress.tsx
scroll-area.tsx   select.tsx        separator.tsx     sheet.tsx
sidebar.tsx       skeleton.tsx      sonner.tsx        textarea.tsx
tooltip.tsx
```

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
7. **Run `pnpm validate`** before considering any feature complete