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

## Code comments

| Check | Command | Rule | Reason |
|---|---|---|---|
| Comment intent | `pnpm lint` | 0 `local/no-history-comments` errors (`eslint-rules/no-history-comments.mjs`) | Comments explain *why*. Issue/PR tags, task numbers, tooling narrative and `file:line` refs belong in the commit or PR, and go stale in the code. Narrative and duplication aren't machine-checkable — see CLAUDE.md, Code Style. |

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
| `tests/main/**`, `tests/preload/**`, `tests/eslint-rules/**` | `tsconfig.node.json` | node (default) |
| `tests/renderer/*.test.ts` | `tsconfig.web.json` | jsdom, via a `// @vitest-environment jsdom` docblock |

`tsconfig.node.json` excludes `tests/renderer`; `tsconfig.web.json` includes it.
A React test placed outside `tests/renderer/` will fail to typecheck.

Folders mirror the code they test (`tests/main/vault/` tests `src/main/vault/`),
and each `pnpm test:<area>` script runs one of them. Split a file by topic once
it grows past a few hundred lines. Fixtures shared by several files live next to
them in a non-`.test.ts` module (`tests/main/vault/helpers.ts`).

`vi.mock` is hoisted only within its own file. A shared module can hold the
mocks (`tests/main/ipc/confirmation-gates/harness.ts`) only when the test files
import the mocked code dynamically, after the harness has loaded; with static
imports, keep the `vi.mock` calls in each test file.

Tests import source through the path aliases (`@main/…`, `@/…`), in `import`,
`vi.mock` and `typeof import()` alike, so a file can move without its paths
changing. Vitest resolves a mocked alias to the same module as the source's
relative import of it.

React tests that depend on effects re-running must pass `reactStrictMode: true`
to `render`/`renderHook`. Wrapping the tree in `<StrictMode>` by hand does
**not** re-run effects under Testing Library, so such a test silently proves
nothing — this was verified with a probe, not assumed.

## Coverage — measured only, not gated

Measured via `pnpm test:coverage`:

| Metric | Value | Previous floor |
|---|---|---|
| Statements | 19.61% (665/3390) | 8.06% (268/3325) |
| Branches | 12.27% (201/1638) | 4.77% (78/1633) |
| Functions | 15.17% (129/850) | 7.09% (58/818) |
| Lines | 20.79% (639/3073) | 8.67% (262/3019) |

Coverage percentage alone does not prove a test asserts anything: a covered
line can still pass against deliberately broken code.

- Floor: the numbers above. From here, coverage must not regress below this
  floor — re-run `pnpm test:coverage` and update this table when it improves.
- Do not invent a target (e.g. "80%") — that's fabricated, not measured.

A percentage can also fall because the denominator shrank: less code under the
same tests (e.g. statements 666/3391 → 665/3390 and functions 131/852 → 129/850
after a simplification pass, same 37 tests). That direction is fine when it is
recorded here with its before/after counts, because the rule above exists to
stop a number being quietly edited down. A drop with no such note, or one where
the test count also fell, is the thing it is guarding against.

## Speed budget

| Tier | Commands | Target | Measured |
|---|---|---|---|
| Fast (edit loop) | `pnpm lint` (eslint `--cache`) | seconds | ~30s cold, faster warm |
| Task-end | `pnpm check:task` (= validate + depcruise + test) | 90s | **~2m55s — over budget** |
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
pnpm check:task      # validate + depcruise + test — before calling work done
pnpm check:full      # check:task + coverage — review/CI
pnpm test            # vitest run — every test
pnpm test:watch      # vitest in watch mode
pnpm test:main       # tests/main (all main-process tests)
pnpm test:vault      # tests/main/vault
pnpm test:db         # tests/main/db
pnpm test:ipc        # tests/main/ipc
pnpm test:app        # tests/main/app (lifecycle, window, updater, guards)
pnpm test:preload    # tests/preload
pnpm test:renderer   # tests/renderer (jsdom)
pnpm test:coverage   # vitest run --coverage
```

## Exceptions

| Rule | Status | Owner | Expiry | Note |
|---|---|---|---|---|
| Secrets scan (gitleaks) | Not installed | GFrancV | 2026-10-07 | Not on npm; real binary is `winget install Gitleaks.Gitleaks`. Skipped installing system-wide during setup per explicit request — install manually, then wire `gitleaks detect --redact --source .` into `check:full`. |
| Dependency vuln scan (osv-scanner) | Not installed | GFrancV | 2026-10-07 | Not on npm; real binary is `winget install Google.OSVScanner`. Same as above — install manually, then wire `osv-scanner scan --lockfile pnpm-lock.yaml` into `check:full`. |
| `check:task` speed budget | Over 90s target (~2m55s) | GFrancV | — | See Speed budget above. No expiry: this is a measured fact about the current tsconfig setup, not a temporary exception someone forgot to clean up. Revisit only if incremental `tsc` is enabled. |

Review the two "not installed" exceptions by the expiry date above — either
install the tools and wire them in, or renew the exception with a reason.
