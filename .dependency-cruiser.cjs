/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'renderer-no-vault-crypto',
      comment:
        'CLAUDE.md: the renderer never imports crypto/vault/db modules or the crypto libraries directly. All crypto and DB operations go through IPC -> the main-process handlers (ipc-handlers.ts, <feature>/ipc.ts) -> vault/db modules.',
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
      name: 'preload-sandbox-compatible',
      comment:
        'The renderer is sandboxed, so the preload can only require electron at runtime. Node builtins or other packages build fine but leave window.notvex undefined.',
      severity: 'error',
      from: { path: '^src/preload' },
      to: {
        dependencyTypes: [
          'core',
          'npm',
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-no-pkg',
          'npm-unknown'
        ],
        dependencyTypesNot: ['type-only'],
        pathNot: '(^|/)node_modules/electron/'
      }
    },
    {
      name: 'features-no-vault-session',
      comment:
        'ipc-handlers.ts holds the vault session state. Modules in a src/main folder get what they need from it as parameters, so none of them can read or change that state directly.',
      severity: 'error',
      from: { path: '^src/main/[^/]+/' },
      to: { path: '^src/main/ipc-handlers\\.ts$' }
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
    tsPreCompilationDeps: true,
    // Without it @main/* and @shared/* stay unresolved, and no rule matches an aliased import.
    tsConfig: { fileName: 'tsconfig.node.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default']
    }
  }
}
