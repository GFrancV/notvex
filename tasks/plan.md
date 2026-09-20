# Plan — Seeder de vaults

Origen: [`SPEC.md`](../SPEC.md). Estado: pendiente de arrancar.

## Grafo de dependencias

```
T1 (kdfTier)  ──┐
                ├─→ T3 (preset minimal + test, necesita tier fijo)
T2 (CLI) ───────┘
T2 ─→ T4 (puerta de calidad: el seeder debe nacer limpio antes de ampliar scope)
T5 opcional, independiente
```

Commit 1 = T1. Commit 2 = T2+T3+T4 (ver nota en T4: separarlos deja `pnpm lint` en rojo).
Commit 3 = T5, solo si se decide hacerlo.

---

## T1 — `kdfTier` opcional en `createVault()`

**Archivos:** `src/main/vault/vault.ts`, `tests/vault.test.ts`, `CONSTRAINTS.md`

Firma nueva: `createVault(filePath, password, opts?: { kdfTier?: number })`.
Sin `opts`, sigue llamando a `calibrateArgon2id(1500)` (vault.ts:346). Con él,
valida por `isValidKdfTier()` y lanza antes de escribir nada.

Los dos únicos llamadores — `ipc-handlers.ts:260` y `tests/vault.test.ts` (14
sitios) — no cambian: el parámetro es opcional.

**Aceptación**
- [ ] `createVault(p, pw)` calibra igual que hoy; ningún llamador editado.
- [ ] `createVault(p, pw, { kdfTier: 10 })` → `readContainer(p).kdfInput.kdfTier === 10`.
- [ ] Tier inválido (0, 11, 3.5) lanza y no deja archivo en disco.
- [ ] `CONSTRAINTS.md` dice que el parámetro es para fixtures y que ningún
      código de producción lo pasa.

**Verificación:** `pnpm test:vault` y `pnpm check:fast`.

**Oportunidad, no scope:** los 14 `createVault` de la suite calibran uno a uno.
Pasarles tier 10 la aceleraría — pero dejaría la calibración sin cubrir. Medir
antes y decidir después, en su propio cambio.

---

## T2 — Seeder CLI

**Archivos:** `scripts/seed-vault.ts` (reescrito), `scripts/fixtures/demo.ts` (nuevo),
`package.json`

**Paso 0, antes de escribir nada — resolver `@shared/*` bajo `tsx`.**
`vault.ts` importa `@shared/types`; el `tsconfig.json` raíz solo tiene
`references`, sin `paths`. Probar en este orden y parar en el primero que
funcione:
1. `tsx scripts/seed-vault.ts`
2. `tsx --tsconfig tsconfig.node.json scripts/seed-vault.ts` (ahí sí están los
   `paths`, aunque sin `baseUrl`)
3. Si ninguno resuelve: ruta esbuild, ya verificada en esta investigación —
   `esbuild --bundle --platform=node --format=cjs --alias:@shared=./src/shared`
   con los nativos como `--external`, salida a `node_modules/.cache/`.

Flags vía `util.parseArgs` (stdlib de Node 22, sin librería de CLI):
`--preset demo|minimal` · `--out <path>` · `--password <pw>` · `--kdf-tier <1-10>` · `--force`

Datos a `scripts/fixtures/demo.ts` (las 28 notas / 12 tags actuales). Los tipos
`TagDef`/`NoteDef` se quedan en `seed-vault.ts` y los fixtures los importan —
tres archivos, no cuatro.

Al final imprime ruta, contraseña **y el mnemonic** que hoy se descarta.

**Aceptación**
- [ ] `pnpm seed:vault` produce `.vaults/demo.nvx` con 26 activas + 2 en papelera, 12 tags, 3 fijadas.
- [ ] Sin `--force`, un `--out` que ya existe aborta **sin tocar el archivo**.
- [ ] La cabecera no afirma nada falso: corre bajo `node`, no requiere Electron.

**Verificación:** `pnpm seed:vault` y abrir el `.nvx` con `pnpm dev`, contraseña impresa.

---

## T3 — Preset minimal + test

**Archivos:** `scripts/fixtures/minimal.ts`, `tests/seed-vault.test.ts`

3 notas / 2 tags, una fijada y una en papelera — lo justo para que un e2e
ejercite lista, filtro por tag y papelera.

El test siembra `minimal` con `--kdf-tier 10` en `mkdtempSync`, reabre con
`openVault` y afirma conteos + que el contenido descifra. **Un test, no una suite.**

**Aceptación**
- [ ] `--preset minimal --kdf-tier 10` siembra y reabre en < 1 s.
- [ ] El test limpia su tmpdir en `afterEach`.

**Verificación:** `pnpm test:vault`.

---

## T4 — Puerta de calidad

**Archivos:** `package.json`, `tsconfig.node.json`, `.gitignore`

- `lint`/`lint:fix`: `eslint src tests scripts`
- `format`/`format:check`: añadir `"scripts/**/*.ts"`
- `tsconfig.node.json` → `include` suma `scripts/**/*`
- `lint-staged` suma un bloque `scripts/**/*.ts`
- `.gitignore` suma `.vaults/`
- Borrar `scripts/inspect-note-list.mjs` y `demo/notvex-demo.nvx`

**Va en el mismo commit que T2/T3 a propósito:** ampliar el scope antes de
reescribir el seeder deja `pnpm lint` en rojo (hoy: 6 warnings de prettier en
`seed-vault.ts`, 1 error de eslint en `inspect-note-list.mjs`).

**Aceptación**
- [ ] `pnpm validate` cubre `scripts/` y pasa en verde.
- [ ] `git status` no muestra ningún `.nvx`.

**Verificación:** `pnpm check:task`.

---

## T5 — `NOTVEX_DEV_VAULT` (opcional)

**Archivos:** `src/main/file-opener.ts`, `CLAUDE.md`

Tres líneas junto al bloque de argv de cold-start, reutilizando
`setValidatedPending()` (ya valida `existsSync` + `isValidNotvexFile`):

```ts
if (!app.isPackaged && process.env.NOTVEX_DEV_VAULT) {
  setValidatedPending(resolve(process.env.NOTVEX_DEV_VAULT))
}
```

Sin script `dev:demo` y sin `cross-env`: se documenta la variable en `CLAUDE.md`.
Sin auto-unlock — metería una ruta que salta el `unlockThrottle` de
`ipc-handlers.ts` dentro del bundle de producción.

**Recordatorio antes de empezar:** `app.setName('Notvex Dev')` ya da a dev su
propio `recentVaults`, así que abrir el demo una vez por la UI lo deja
recordado. Esto solo compra el primer arranque y el estado limpio. Si eso no
duele, no hacerlo.

**Aceptación**
- [ ] `NOTVEX_DEV_VAULT=.vaults/demo.nvx pnpm dev` arranca en Unlock apuntando al demo.
- [ ] Una ruta inexistente o un archivo que no es `.nvx` se ignoran en silencio.
- [ ] `pnpm dev` sin la variable se comporta exactamente como hoy.

---

## Checkpoints

| Tras | Comprobación |
|---|---|
| T1 | `pnpm check:task` verde. Revisión humana: es el único cambio en la ruta cripto. |
| T4 | `pnpm check:task` verde + `pnpm seed:vault` produce un vault que la app abre. |
| T5 | `pnpm dev` con y sin la variable. |
