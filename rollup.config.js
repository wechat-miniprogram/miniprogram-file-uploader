import {eslint} from 'rollup-plugin-eslint'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/uploader.js',
    format: 'esm',
    sourcemap: true
  },
  plugins: [
    eslint({
      fix: true
    }),
    resolve(),
    commonjs()
  ]
}
