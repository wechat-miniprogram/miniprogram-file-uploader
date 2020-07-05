import {eslint} from 'rollup-plugin-eslint'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import {version} from './package.json'

const banner = `
/**
 * miniprogram-uploader ${version}
 * description: A JavaScript library supports miniprogram to upload large file.
 * author: sanfordsun
 * Released under the MIT License.
 */
`
export default {
  input: 'src/main.js',
  output: [
    {
      banner,
      file: 'dist/uploader.js',
      format: 'esm',
      sourcemap: true
    },
    {
      banner,
      file: 'example/client/lib/uploader.js',
      format: 'esm',
      sourcemap: false
    },
  ],
  plugins: [
    eslint({
      fix: true,
      include: ['src/**/*.js']
    }),
    resolve(),
    commonjs()
  ]
}
