/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'com.notvex.app',
  productName: 'Notvex',
  copyright: 'Copyright © 2026 Notvex',
  directories: {
    output: 'dist-release',
  },
  files: [
    'out/**/*',
    'node_modules/**/*',
    '!node_modules/.cache',
  ],
  extraResources: [],
  asar: true,
  asarUnpack: [
    'node_modules/@journeyapps/sqlcipher/**',
    'node_modules/node-hid/**',
    'node_modules/libsodium-wrappers/**',
  ],
  npmRebuild: true,
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    icon: 'resources/icon.ico',
    requestedExecutionLevel: 'asInvoker',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'resources/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'resources/icons',
    category: 'Office',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
  },
}
