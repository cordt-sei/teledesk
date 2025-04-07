// eslint.config.js
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      indent: [
        'error',
        2,
        { SwitchCase: 1 }
      ],
      'linebreak-style': [
        'error',
        'unix'
      ],
      quotes: [
        'error',
        'single',
        { avoidEscape: true, allowTemplateLiterals: true }
      ],
      semi: [
        'error',
        'always'
      ],
      'no-unused-vars': [
        'warn',
        { 
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_' 
        }
      ],
      'no-constant-condition': [
        'error',
        { checkLoops: false }
      ],
      'no-console': 'off',
      'no-async-promise-executor': 'warn',
      'require-await': 'warn',
      'no-return-await': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['warn', 'always'],
      'comma-dangle': ['warn', 'never']
    }
  },
  {
    ignores: [
      'node_modules/',
      'logs/',
      'data/',
      'dist/',
      'build/',
      '.env',
      '.env.*',
      'ecosystem.config.cjs',
      'coverage/'
    ]
  }
];