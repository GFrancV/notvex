# Notvex

Secure, fully-local desktop notes. All data lives in a single SQLCipher-encrypted SQLite database. No account, no server, no network — your notes never leave your machine.

## Security

- **SQLCipher**: AES-256 page-level encryption of the entire database
- **Field-level encryption**: Each note's title and content are individually encrypted with XChaCha20-Poly1305 and a random nonce
- **Argon2id** key derivation (OPSLIMIT_MODERATE / MEMLIMIT_MODERATE)
- **Recovery key**: 24-word BIP39 mnemonic generated on vault creation — the only way to recover data if the password is lost
- **YubiKey**: HMAC-SHA1 challenge-response via HID (slot 2)
- **Master key never written to disk** — zeroed with `sodium.memzero()` on lock

## Development

### Prerequisites

- Node.js 18+
- Windows: Visual Studio Build Tools with the "Desktop development with C++" workload

### Install

```bash
git clone <repo>
cd notvex
npm install
```

`npm install` automatically rebuilds `@journeyapps/sqlcipher` for the installed Electron version.

### Run

```bash
npm run dev
```

### Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Installers and portables are output to `dist-release/`.

## Linux: YubiKey udev rules

YubiKey access via USB HID requires a udev rule:

```bash
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1050", MODE="0664", GROUP="plugdev"' | \
  sudo tee /etc/udev/rules.d/70-yubikey.rules
sudo udevadm control --reload-rules
sudo usermod -aG plugdev $USER
# Log out and back in
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+L` | Lock vault |
| `Ctrl+N` | New note |
| `Ctrl+P` | Toggle preview |
| `Ctrl+Shift+T` | Toggle trash view |

## Vault files

The vault creates two files in the chosen directory:

| File | Contents |
|---|---|
| `notvex.db` | SQLCipher-encrypted SQLite database |
| `notvex.json` | Bootstrap metadata (Argon2 salt, verify hash, recovery-encrypted key) |

`notvex.json` contains non-sensitive bootstrap data (the salt is public by design) and the master key encrypted with the recovery key. Opening `notvex.db` with DB Browser for SQLite without the key shows only binary garbage.

## Security warning

> **If you lose your master password AND your recovery key, your notes are irrecoverable.** There is no account reset, no server backup, no way to recover. Store your recovery key in a password manager or write it down and keep it safe.
