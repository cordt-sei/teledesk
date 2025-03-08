import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve, { nodeResolve } from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

const lambdaFunctions = [
  {
    input: './lambda/telegram-webhook.js',
    output: './dist/telegram-webhook',
  },
  {
    input: './lambda/slack-interactions.js',
    output: './dist/slack-interactions',
  },
  {
    input: './lambda/set-webhook.js',
    output: './dist/set-webhook',
  },
];

export default lambdaFunctions.map(({ input, output }) => ({
  input,
  output: {
    dir: output,
    format: 'cjs', // AWS Lambda requires CommonJS
    sourcemap: true,
  },
  plugins: [
    resolve({ exportConditions: ['node'], preferBuiltins: true }), // Resolve node_modules
    commonjs(), // Convert CommonJS to ES6
    terser(), // Minify output
    json(), // Parse JSON files
    nodeResolve({ preferBuiltins: true }),
  ],
  external: [
    'aws-sdk',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
  ], // Exclude AWS SDK (already in Lambda runtime)
  onwarn: function(warning) {
    // Skip certain warnings
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    console.warn(warning.message);
  },
}));