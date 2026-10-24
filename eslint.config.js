import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env'], MemberExpression[object.name='process'][property.value='env']",
          message: 'Read environment variables only in src/daemon/config.ts or src/cli/config.ts.',
        },
      ],
    },
  },
  {
    files: ['src/daemon/config.ts', 'src/cli/config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/core/**', 'src/protocol/**'],
    rules: { 'no-console': 'error' },
  },
  prettier,
];
