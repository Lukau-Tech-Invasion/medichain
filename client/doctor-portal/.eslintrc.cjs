module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    // Static accessibility checks on JSX. These catch the failures that are
    // structural rather than visual — an icon-only button with no accessible
    // name, a click handler on a <div> that no keyboard can reach, a form
    // control with no associated label. None of those show up in a contrast
    // matrix or a screenshot, and all of them make a screen unusable for
    // somebody.
    'plugin:jsx-a11y/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'jsx-a11y'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    'react-hooks/exhaustive-deps': 'warn',

    // --- Accessibility -----------------------------------------------------
    //
    // Errors, not warnings, for the rules where a violation means a user simply
    // cannot complete the task. A warning in a codebase with an existing lint
    // backlog is indistinguishable from no rule at all.
    //
    // A clinician who navigates by keyboard, or a patient using a screen
    // reader on their own records, is not a hypothetical user of a national
    // health-ID system — they are a foreseeable one.
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',

    // Warnings for the rules that need a judgement call or have a large
    // existing backlog. These are tracked down over time rather than silenced;
    // see docs/TECHNICAL_DEBT_REGISTER.md.
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'jsx-a11y/label-has-associated-control': 'warn',
    'jsx-a11y/no-autofocus': 'warn',
  },
}
