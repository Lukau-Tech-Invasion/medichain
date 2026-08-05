module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // This package IS a hooks library (src/hooks, src/api/hooks.ts), so the
    // hook rules apply to it more than to anything else in the repo. Without
    // the plugin, `eslint-disable-next-line react-hooks/exhaustive-deps` in
    // src/api/hooks.ts referenced a rule ESLint had never heard of, which is
    // itself an error — so linting this package failed outright and the
    // dependency-array bugs the comment was acknowledging went unchecked.
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist'],
  parser: '@typescript-eslint/parser',
  rules: {
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'prefer-const': 'warn',
  },
}
