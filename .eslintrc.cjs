module.exports = {
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
    extraFileExtensions: ['.svelte']
  },
  extends: ['standard-with-typescript'],
  plugins: [
    'svelte3',
    '@typescript-eslint'
  ],
  // Disable these rules: import/first, import/no-duplicates, import/no-mutable-exports, import/no-unresolved, import/prefer-default-export
  // Reference: https://github.com/sveltejs/eslint-plugin-svelte3/blob/master/OTHER_PLUGINS.md#eslint-plugin-import
  rules: {
    '@typescript-eslint/consistent-type-assertions': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
    '@typescript-eslint/strict-boolean-expressions': 'off',
    'import/first': 'off',
    'import/no-duplicates': 'off',
    'import/no-mutable-exports': 'off',
    'import/no-unresolved': 'off',
    'import/prefer-default-export': 'off',
    'no-multiple-empty-lines': ['error', { max: 2, maxBOF: 2, maxEOF: 0 }], // See: https://github.com/sveltejs/eslint-plugin-svelte3/issues/41
    'no-return-assign': 'off',
    'no-unmodified-loop-condition': 'off'
  },
  overrides: [
    {
      files: [
        '**/*.svelte'
      ],
      processor: 'svelte3/svelte3'
    }
  ],
  settings: {
    'svelte3/typescript': true
  },
  ignorePatterns: ['node_modules/*', 'dist/*', 'src-tauri/*', '抢救/**', '.eslintrc.cjs', '*.json']
}
