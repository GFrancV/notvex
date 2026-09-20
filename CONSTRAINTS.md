# Constraints

Enforced quality/security bar for this repo. Agents must not weaken any rule
here to make a change pass — fix the change instead. If a rule is genuinely
wrong, edit this file in its own commit and say why.

Enforcement mode: **block**. A failing check stops the task; fix it before
continuing.

## Floor (existing, unchanged)

| Check | Command | Rule |
|---|---|---|
| Types | `pnpm typecheck` | 0 errors across main/preload/renderer tsconfigs |
| Lint | `pnpm lint` | `eslint --max-warnings 0` |
| Format | `pnpm format:check` | Prettier clean |

## Security

| Check | Command | Rule | Reason |
|---|---|---|---|
| Vault/IPC boundary | `pnpm depcruise` | 0 violations of `renderer-no-vault-crypto` (`.dependency-cruiser.cjs`) | Codifies the CLAUDE.md rule: renderer must never import `src/main/vault/**`, `src/main/db/**`, `@journeyapps/sqlcipher`, or `libsodium-wrappers-sumo` directly — everything crosses the IPC boundary. |
| Secrets scan | *(pending, see Exceptions)* | 0 findings, `gitleaks detect --redact` | Vault key material / recovery phrases must never land in a commit. |
| Dependency vulns | *(pending, see Exceptions)* | 0 high/critical, `osv-scanner scan .` | `@journeyapps/sqlcipher`, `libsodium-wrappers-sumo`, `koffi` are native-binding deps in the crypto path — a known CVE there is high-severity for this app specifically. |

## Architecture

Same `pnpm depcruise` run as above — one dependency-cruiser config, two
concerns (boundary correctness doubles as the architecture check for now).
Add a second rule to `.dependency-cruiser.cjs` if another boundary needs
enforcing later; don't add a second tool for it.

## Test file location

Test files live under `tests/` at the project root, never colocated inside
`src/`. `pnpm lint`/`pnpm format`/`typecheck` all cover `tests/**` explicitly —
a test file outside that scope is silently unchecked by all three.

Two typecheck scopes, because React tests need `jsx` and DOM libs that the
main-process config must not carry:

| Location | tsconfig | Environment |
|---|---|---|
| `tests/*.test.ts` | `tsconfig.node.json` | node (default) |
| `tests/renderer/*.test.ts` | `tsconfig.web.json` | jsdom, via a `// @vitest-environment jsdom` docblock |

`tsconfig.node.json` excludes `tests/renderer`; `tsconfig.web.json` includes it.
A React test placed outside `tests/renderer/` will fail to typecheck.

React tests that depend on effects re-running must pass `reactStrictMode: true`
to `render`/`renderHook`. Wrapping the tree in `<StrictMode>` by hand does
**not** re-run effects under Testing Library, so such a test silently proves
nothing — this was verified with a probe, not assumed.

## Coverage — measured only, not gated

First test file landed with issue #16's fix: `tests/vault.test.ts`
(regression test for `packContainer()` ignoring the WAL — see git history).
Measured via `pnpm test:coverage`:

| Metric | Value | Floor before #19 |
|---|---|---|
| Statements | 19.64% (666/3391) | 8.06% (268/3325) |
| Branches | 12.27% (201/1638) | 4.77% (78/1633) |
| Functions | 15.37% (131/852) | 7.09% (58/818) |
| Lines | 20.79% (639/3073) | 8.67% (262/3019) |

Read the jump carefully — it is two separate things:

- **~240 covered statements were already earned.** The old floor was recorded
  before PR #28 landed its vault regression tests and was never refreshed on
  merge, so that backlog is only now being measured.
- **Issue #19 added 21 tests across 4 files**, covering `pending-save.ts`
  (25/25 statements), `drain-renderer.ts`, the `usePendingSave` lifecycle and
  the note-title persistence path.

Every one of those 21 was verified by mutation: the covered code was broken on
purpose and the test confirmed to fail. Coverage percentage alone does not
prove a test asserts anything — one of them passed against a deliberately
broken build until it was fixed, and a five-axis review still found a bug all
of them missed, because they modelled a commit as instantaneous.

- Floor: the numbers above. From here, coverage must not regress below this
  floor — re-run `pnpm test:coverage` and update this table when it improves.
- Do not invent a target (e.g. "80%") — that's fabricated, not measured.

## Speed budget

| Tier | Commands | Target | Measured |
|---|---|---|---|
| Fast (edit loop) | `pnpm lint` (eslint `--cache`) | seconds | ~30s cold, faster warm |
| Task-end | `pnpm check:task` (= validate + depcruise + test:vault) | 90s | **~2m55s — over budget** |
| Full (review/CI) | `pnpm check:full` (= check:task + coverage) | unlimited | not yet run in CI |

The 90s task-end target isn't met: `pnpm typecheck` alone measures **~2m13s**
because it runs three separate `tsc --noEmit` invocations
(`tsconfig.json` + node + web) with `--composite false`, which disables
incremental caching on every run. That's a pre-existing property of the
tsconfig split, not something this pass changed — flagging it here rather
than restructuring the TS project setup as an unscoped side quest. If task-end
speed becomes a real problem, the fix is enabling incremental `tsc` builds
(cache the `.tsbuildinfo` files instead of `--composite false`), not dropping
typecheck from the gate.

Until then: run `pnpm lint` (and `pnpm depcruise`, ~11s) during a task;
save `pnpm check:task` for before marking work done, same as
`pnpm validate` was already used per CLAUDE.md.

## Scripts

```bash
pnpm depcruise       # architecture/IPC-boundary check (.dependency-cruiser.cjs)
pnpm check:fast      # typecheck + lint — edit loop
pnpm check:task      # validate + depcruise + test:vault — before calling work done
pnpm check:full      # check:task + coverage — review/CI
pnpm test:vault      # vitest run --passWithNoTests
pnpm test:coverage   # vitest run --coverage --passWithNoTests
```

## Exceptions

| Rule | Status | Owner | Expiry | Note |
|---|---|---|---|---|
| Secrets scan (gitleaks) | Not installed | GFrancV | 2026-10-07 | Not on npm; real binary is `winget install Gitleaks.Gitleaks`. Skipped installing system-wide during setup per explicit request — install manually, then wire `gitleaks detect --redact --source .` into `check:full`. |
| Dependency vuln scan (osv-scanner) | Not installed | GFrancV | 2026-10-07 | Not on npm; real binary is `winget install Google.OSVScanner`. Same as above — install manually, then wire `osv-scanner scan --lockfile pnpm-lock.yaml` into `check:full`. |
| `check:task` speed budget | Over 90s target (~2m55s) | GFrancV | — | See Speed budget above. No expiry: this is a measured fact about the current tsconfig setup, not a temporary exception someone forgot to clean up. Revisit only if incremental `tsc` is enabled. |

Review the two "not installed" exceptions by the expiry date above — either
install the tools and wire them in, or renew the exception with a reason.
