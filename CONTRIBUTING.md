# Contributing to Notvex

Thanks for helping. Notvex keeps people's notes encrypted on their own computer, so changes are held to a strict bar on security and privacy. This guide covers what you need to get a change merged.

## Before you start

- **Bugs:** open an issue with the bug report form. Never include note content, passwords or a recovery key.
- **Security vulnerabilities:** don't open an issue. Report them privately as described in [SECURITY.md](./SECURITY.md).
- **New features or larger changes:** open an issue first and wait for a go-ahead, so no one spends time on work that won't be merged.
- **Small fixes** (a typo, an obvious bug with a clear fix) can go straight to a pull request.

Search the existing issues before opening a new one.

## Setup

Prerequisites and install steps are in the README's [Development](./README.md#development) section. `pnpm dev` starts the app.

## Making a change

1. Fork the repository and branch from `main`: `fix/short-name` or `feat/short-name`, or `fix/issue-123-short-name` when there's an issue.
2. Read [CLAUDE.md](./CLAUDE.md). Despite its name, it's the project guide for people and coding agents alike: architecture, the IPC pattern, code style, UI rules and security rules. [CONSTRAINTS.md](./CONSTRAINTS.md) is the quality bar the checks enforce.
3. The rules that matter most:
   - The renderer never imports crypto, SQLCipher or vault code. Everything goes through IPC (`ipc-handlers.ts` → `preload/index.ts` → `lib/ipc.ts`).
   - UI: reuse what's in `src/renderer/src/components/ui/`, use the semantic color tokens from `main.css`, no inline styles, dark mode only.
   - Copy: sentence case, and error messages start with "Couldn't …".
   - Tests go in `tests/`, in the folder that mirrors `src/`, never next to the code.

## Checks

```bash
pnpm check:task
```

It runs typecheck, lint, format, the IPC boundary check, commit messages and the tests. CI runs the same checks on every pull request.

`pnpm test:vault` and `pnpm test:main` derive keys with Argon2id and use a lot of memory. On a machine with little RAM, run the other areas (`pnpm test:renderer`, `pnpm test:db`, …) while you work.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/) in lowercase: `feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `test:`, `docs:`, `chore:`, `build:` or `revert:`, with an optional scope (`fix(editor): …`).
- The first line is at most 72 characters.
- One logical change per commit. Pull requests are merged with a merge commit, so your commits reach `main` as you wrote them.

commitlint checks every commit locally and in CI.

## Pull requests

- Fill in the template: what changes and why, a test plan that says what you actually checked, and `Closes #123` when there's an issue.
- Keep a pull request to one change. Unrelated fixes go in their own.
- Screenshots: use a test vault, never your real notes. Turn off **Settings → Security → Prevent screen capture** first, or they come out black on Windows and macOS.

### Using AI tools

They're welcome. You're responsible for what you submit: read and understand every line, run the checks, and be ready to explain any of it in review.

## License

By contributing, you agree that your contributions are licensed under the [GNU AGPL-3.0](./LICENSE), the project's license.
