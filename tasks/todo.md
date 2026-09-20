# TODO — Seeder de vaults

Plan: [`plan.md`](./plan.md) · Spec: [`../SPEC.md`](../SPEC.md)

## Commit 1 — ruta cripto
- [x] T1 · `kdfTier` opcional en `createVault()` + validación con `isValidKdfTier()`
- [x] T1 · test en `tests/vault.test.ts`: tier 10 → header lo refleja; tier inválido lanza
- [x] T1 · nota en `CONSTRAINTS.md`: parámetro solo para fixtures
- [x] ✅ Checkpoint: `pnpm check:task` + revisión humana

## Commit 2 — seeder y puerta de calidad
- [ ] T2 · paso 0: verificar que `tsx` resuelve `@shared/*` (si no, `--tsconfig`, y si no, esbuild)
- [ ] T2 · `tsx` a devDependencies + script `seed:vault`
- [ ] T2 · flags con `util.parseArgs`: `--preset --out --password --kdf-tier --force`
- [ ] T2 · mover las 28 notas / 12 tags a `scripts/fixtures/demo.ts`
- [ ] T2 · imprimir mnemonic (hoy se descarta)
- [ ] T3 · `scripts/fixtures/minimal.ts` (3 notas / 2 tags)
- [ ] T3 · `tests/seed-vault.test.ts` — siembra minimal, reabre, afirma
- [ ] T4 · `scripts` en lint, format, `tsconfig.node.json` y lint-staged
- [ ] T4 · `.vaults/` a `.gitignore`; borrar `inspect-note-list.mjs` y `demo/notvex-demo.nvx`
- [ ] ✅ Checkpoint: `pnpm check:task` + el vault sembrado abre en la app

## Commit 3 — opcional, decidir antes de hacerlo
- [ ] T5 · `NOTVEX_DEV_VAULT` en `file-opener.ts` + documentarlo en `CLAUDE.md`
