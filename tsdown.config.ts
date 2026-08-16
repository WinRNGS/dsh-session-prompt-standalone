// dsh-session-prompt 客户端 UI 打包配置。
// 宿主侧仍由 scripts/build.sh（tsc）构建；这里只把 src/client/index.ts 打成
// DSH client-module 格式的 lib/client.js。
const PLUGIN_ID = '@dsh-external/dsh-session-prompt'

// 浏览器端不打包的运行时依赖（由 DSH client 运行时提供）。
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-conversation',
]

export default {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}
