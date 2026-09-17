/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'renderer-no-vault-crypto',
      comment:
        'CLAUDE.md: the renderer never imports crypto/vault/db modules or the crypto libraries directly. All crypto and DB operations go through IPC -> ipc-handlers.ts -> vault/db modules.',
      severity: 'error',
      from: { path: '^src/renderer' },
      to: {
        path: [
          '^src/main/vault',
          '^src/main/db',
          'node_modules/@journeyapps/sqlcipher',
          'node_modules/libsodium-wrappers-sumo'
        ]
      }
    },
    {
      name: 'no-circular',
      comment: 'Circular imports make the IPC/vault boundary harder to reason about.',
      severity: 'warn',
      from: {},
      to: { circular: true }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src',
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default']
    }
  }
}
