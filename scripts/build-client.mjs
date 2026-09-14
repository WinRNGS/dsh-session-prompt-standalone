#!/usr/bin/env node
// Build the client bundle with the DSH checkout's tsdown.
// Keeps the plugin directory free of a local tsdown dependency.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const candidates = [
  process.env.DSH_CHECKOUT,
  join(homedir(), 'dsh-harness'),
  join(homedir(), 'dsh'),
  join(homedir(), 'deepseek-harness'),
].filter(Boolean)

const checkout = candidates.find((dir) => existsSync(join(dir, 'packages')))
if (!checkout) {
  console.error('build-client: cannot locate the dsh checkout (set DSH_CHECKOUT)')
  process.exit(1)
}

const run = join(checkout, 'node_modules', 'tsdown', 'dist', 'run.mjs')
if (!existsSync(run)) {
  console.error(`build-client: tsdown not found at ${run}`)
  process.exit(1)
}

console.log(`=== Building client bundle (checkout: ${checkout}) ===`)
const result = spawnSync(process.execPath, [run], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DSH_CHECKOUT: checkout },
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
