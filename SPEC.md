# SPEC — Seeder de vaults (demo + fixtures)

Estado: propuesto · 2026-09-19

## Objetivo

Un comando que produce un `.nvx` real y poblado, para (a) usar la app con
contenido creíble sin tocar vaults propios y (b) servir de fixture a futuros
tests e2e.

Hoy existe `scripts/seed-vault.ts` sin commitear: funciona (verificado: 28
notas / 12 tags / reapertura y descifrado OK) pero es un one-shot rígido,
invisible para la puerta de calidad, y su cabecera documenta un runtime y un
script de npm que no existen.

Usuario: el mantenedor del repo, y cualquier agente que necesite un vault
poblado para verificar un cambio.

## Mapa de capacidades

| id | Capacidad | Depende de | Commit |
|----|-----------|-----------|--------|
| M1 | `kdfTier` opcional en `createVault()` | — | 1 |
| M2 | Seeder CLI + presets + `scripts/` dentro de la puerta de calidad | M1 | 2 |
| M3 | *(opcional)* `NOTVEX_DEV_VAULT` para arrancar dev sobre el demo | M2 | 3 |

M1 va primero y solo: toca la ruta criptográfica.
M3 es opcional — ver su sección.

---

## M1 — `kdfTier` opcional en `createVault()`

**Por qué.** `createVault()` llama a `calibrateArgon2id(1500)`: el tier lo
decide la máquina que siembra y queda escrito en el header, sin recalibrar al
abrir. Medido aquí: tier 3 = 256 MB / 4 pases = **1.75 s y 256 MB por cada
unlock**. Inviable como fixture de tests.

**Qué.** `createVault(path, password, opts?: { kdfTier?: number })`. Sin
`opts`, comportamiento idéntico al de hoy. Valida con `isValidKdfTier()` y
lanza si no.

**Criterios de aceptación**
- `createVault(p, pw)` sigue calibrando — ningún llamador existente cambia.
- `createVault(p, pw, { kdfTier: 10 })` → `readContainer(p).kdfInput.kdfTier === 10`.
- Tier inválido → lanza antes de escribir nada.
- Nota en `CONSTRAINTS.md`: el parámetro existe para fixtures; ningún código
  de producción lo pasa.

**Check:** un `it()` en `tests/vault.test.ts` que siembra con tier 10 y lee el
header. Cubre los tres criterios.

---

## M2 — Seeder CLI

### Comandos

```bash
pnpm seed:vault                              # preset demo → .vaults/demo.nvx
pnpm seed:vault -- --preset minimal --out /tmp/t.nvx --kdf-tier 10
```

```
--preset demo|minimal   default: demo
--out <path>            default: .vaults/demo.nvx
--password <pw>         default: NotvexDemo2026!
--kdf-tier <1-10>       default: calibrar (como la app real)
--force                 requerido para sobrescribir un archivo existente
```

Runner: `tsx` (nueva devDependency). Parseo de flags: `util.parseArgs` de la
stdlib de Node 22 — sin librería de CLI.

Al terminar imprime ruta, contraseña **y el mnemonic de recuperación**, que
hoy se descarta: sin esas palabras no se puede ejercitar
`post-recovery-reset.tsx`.

### Estructura

```
scripts/seed-vault.ts        CLI + orquestación + tipos TagDef/NoteDef (~90 líneas)
scripts/fixtures/demo.ts     las 28 notas / 12 tags actuales
scripts/fixtures/minimal.ts  3 notas / 2 tags
```

Hoy son 675 líneas con ~615 de datos: separar datos de lógica es lo único que
hace falta para que crezca.

Se borra `scripts/inspect-note-list.mjs`: importa Playwright por ruta literal
a `.pnpm/playwright-core@1.61.1/` (dep transitiva, ni siquiera está en
`package.json`) y escribe a una ruta absoluta de una máquina concreta. Es el
residuo de una sesión de debug.

### Artefacto

`.vaults/` va a `.gitignore`. El `.nvx` no se versiona: sus fechas se congelan
en el momento del seed (el binario actual, sembrado el 10 de julio, ya arrastra
71 días de desfase) y abrirlo lo reescribe siempre —
`closeVault()` → `packContainer()` → `atomicWrite()`, haya cambios o no.

### Puerta de calidad

`scripts/` queda dentro de `lint`, `format`, `format:check`, del `include` de
`tsconfig.node.json` y de `lint-staged` — igual que `tests/`, y por la razón
que `CONSTRAINTS.md` ya da en *Test file location*: fuera de scope es
silenciosamente no verificado. Medido hoy sobre los archivos sin commitear:
6 warnings de prettier y 1 error de eslint que `pnpm validate` no ve.

### Criterios de aceptación

- `pnpm seed:vault` produce un `.nvx` que la app abre con la contraseña impresa.
- `--preset minimal --kdf-tier 10` siembra y reabre en < 1 s.
- Sin `--force`, un `--out` existente aborta sin tocar el archivo.
- `pnpm validate` cubre `scripts/` y pasa en verde.
- La cabecera del archivo no afirma nada falso: corre bajo `node` puro
  (`@journeyapps/sqlcipher` trae prebuild napi-v6, ABI-estable; verificado).

**Check:** `tests/seed-vault.test.ts` — siembra `minimal` con tier 10 en
`mkdtempSync`, reabre con `openVault`, afirma conteo de notas/tags y que el
contenido descifra. Un test, no una suite.

---

## M3 — Vault de desarrollo (opcional)

`app.setName('Notvex Dev')` ya da a dev su propio `userData`, y por tanto su
propio `recentVaults`: abres el demo una vez por la UI y dev lo recuerda. La
env var solo compra el primer arranque y el estado limpio reproducible.

Si se quiere igualmente, son 3 líneas en `file-opener.ts` junto al bloque de
argv:

```ts
if (!app.isPackaged && process.env.NOTVEX_DEV_VAULT) {
  setValidatedPending(resolve(process.env.NOTVEX_DEV_VAULT))
}
```

Reutiliza `setValidatedPending()`, que ya valida `existsSync` +
`isValidNotvexFile`. Sin script `dev:demo`: `electron-vite dev` no reenvía
argv al binario de Electron (`spawn(electronPath, [entry].concat(args))`, y
`args` son solo flags de inspector/sandbox), pero sí hereda el entorno — se
documenta la variable y se evita añadir `cross-env`.

No se auto-desbloquea. Meter la contraseña por entorno crearía una ruta que
salta el `unlockThrottle` de `ipc-handlers.ts`, presente en el bundle de
producción aunque esté tras `isPackaged`.

---

## Fuera de alcance

- **e2e.** El seeder expone `--preset minimal --out --kdf-tier`, que es todo
  lo que un runner necesita. No se añade `@playwright/test` ni se escribe
  ningún test e2e hasta que haya uno real que escribir.
- **Presets de key-file y de versión antigua.** `FeatureLockedByVersion.tsx` y
  `MigrationRequiredDialog.tsx` no tienen hoy forma cómoda de alcanzarse.
  Añadir `--key-file` y `--version-min` cuando toque tocar esas pantallas.
- **Fechas relativas al momento de abrir.** El vault sigue envejeciendo; se
  regenera, que cuesta 10 s.

## Estilo y límites

Estilo: el de `CLAUDE.md` (sin punto y coma, comillas simples, 100 cols, sin
`any`, kebab-case fuera de componentes React). Sin repetirlo aquí.

Nunca: bajar un umbral de `CONSTRAINTS.md` para que algo pase; tocar
`contextIsolation`/`nodeIntegration`; importar vault o cripto desde el
renderer; versionar un `.nvx`.

Preguntar antes de: añadir cualquier dependencia más allá de `tsx`; cambiar
una firma de `src/main/vault/**` que no sea la de M1.
