module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    // Static accessibility checks on JSX, matching the clinician portal. The
    // patient app had none: it is the half of the product a person uses on
    // their own phone, on their own medical record, and the emergency card is
    // the screen a paramedic reads.
    'plugin:jsx-a11y/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  overrides: [
    {
      // ServiceWorkerGlobalScope, not a window: `clients` and `skipWaiting` are
      // real globals there.
      files: ['public/sw.js'],
      env: { serviceworker: true, browser: true },
    },
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'jsx-a11y'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // A leading underscore marks a binding as deliberately unused; honour it
    // rather than leaving the convention decorative.
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_',
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'react-hooks/exhaustive-deps': 'warn',

    // --- Accessibility -----------------------------------------------------
    // Errors where a violation means a person simply cannot complete the task.
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',

    // Warnings where the fix needs a judgement call.
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/label-has-associated-control': 'warn',
    'jsx-a11y/no-autofocus': 'warn',
  },
}
