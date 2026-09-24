import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
    globalIgnores(['dist', 'coverage', 'cypress/screenshots', 'cypress/videos']),
    {
        files: ['**/*.{js,jsx}'],
        extends: [
            js.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        plugins: {
            '@stylistic': stylistic,
        },
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
            parserOptions: {
                ecmaVersion: 'latest',
                ecmaFeatures: { jsx: true },
                sourceType: 'module',
            },
        },
        rules: {
            'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
            // house style (CLAUDE.md §5): every block brace on its own line; object literals are not blocks
            '@stylistic/brace-style': ['error', 'allman'],
        },
    },
    {
        files: ['cypress/**'],
        languageOptions: {
            globals: { ...globals.mocha, cy: 'readonly', Cypress: 'readonly' },
        },
    },
    {
        // tests and tool configs run under node / vitest, not the browser
        files: ['**/*.test.{js,jsx}', 'src/test/**', '*.config.js', 'cypress/**'],
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            'react-refresh/only-export-components': 'off',
        },
    },
])
