# Security Policy

Notvex stores notes in a single SQLCipher-encrypted local database. There is no
account, no server, and no network sync — but the crypto stack (Argon2id, XChaCha20-Poly1305,
SQLCipher, BIP39 recovery, IPC boundary between main/renderer) is exactly the
kind of code where a subtle bug can quietly break the guarantees users are
trusting. If you find one, please report it privately rather than opening a
public issue.

## Supported Versions

Notvex ships auto-updates via `electron-updater` and does not maintain parallel
release branches. Only the **latest released version** (see
[Releases](https://github.com/GFrancV/notvex/releases)) receives security fixes.
If you're on an older version, please update before reporting — the issue may
already be fixed.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report privately using one of:

- **GitHub Private Vulnerability Reporting** (preferred): go to the
  [Security tab](https://github.com/GFrancV/notvex/security/advisories/new) of
  this repository and click "Report a vulnerability".
- **Email**: [gfrancv@hotmail.com](mailto:gfrancv@hotmail.com)

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal repro is ideal)
- The affected version/commit and platform (Windows/macOS/Linux)

### What to expect

- **Acknowledgement** within 5 business days.
- An initial assessment (confirmed / needs more info / declined) within
  14 days of acknowledgement.
- If confirmed, a fix is prioritized and a coordinated disclosure timeline is
  agreed with you before any public write-up. Credit is given in the release
  notes / advisory unless you'd prefer to stay anonymous.
- If declined (not a vulnerability, out of scope, etc.), an explanation of why.

## Scope

**In scope:**
- Key derivation, encryption, or memory-handling bugs in `src/main/vault/`
  (e.g. weak KDF params, key material left unzeroed, nonce reuse, timing
  leaks in comparisons)
- Database encryption issues in `src/main/db/` or the SQLCipher integration
- IPC boundary issues that let the renderer read/derive secrets it shouldn't
  (`src/main/ipc-handlers.ts`, `src/preload/`) — e.g. the master key or
  decrypted note content leaking outside the main process
- Recovery key (BIP39) or key-file handling flaws
- Ways to bypass vault lock, `setContentProtection`, or auto-lock behavior
- Supply-chain concerns in build/release tooling (`electron-builder.yml`,
  `.github/workflows/`)

**Out of scope:**
- Attacks requiring physical access to an already-unlocked device
- Social engineering
- Issues in third-party dependencies without a demonstrated path to impact in
  Notvex itself (report those upstream)
- Missing security headers/best-practice nitpicks with no demonstrated
  exploit, given Notvex loads no remote content and has no network surface
