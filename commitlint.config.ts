export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'style', 'test', 'docs', 'chore', 'revert', 'build']
    ],
    'header-max-length': [2, 'always', 72]
  }
}
