import {eslint} from 'rollup-plugin-eslint'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'

export default {
  input: 'src/main.js',
  output: [
    {
      file: 'dist/uploader.js',
      format: 'esm',
      sourcemap: true
    },
    {
      file: 'example/client/lib/uploader.js',
      format: 'esm',
      sourcemap: false
    },
  ],
  plugins: [
    eslint({
      fix: true
    }),
    resolve(),
    commonjs()
  ]
}
