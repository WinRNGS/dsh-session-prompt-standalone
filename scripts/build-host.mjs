#!/usr/bin/env node
// Cross-platform host build. Links the DSH checkout's workspace packages, then
// invokes its TypeScript compiler so this plugin does not need duplicate copies.
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const typecheckOnly = process.argv.includes('--noEmit')
const candidates = [
  process.env.DSH_CHECKOUT,
  join(homedir(), 'dsh-harness'),
  join(homedir(), 'dsh'),
  join(homedir(), 'deepseek-harness'),
].filter(Boolean)

const checkout = candidates.find(dir => existsSync(join(dir, 'packages')))
if (!checkout) {
  console.error('build-host: cannot locate the dsh checkout (set DSH_CHECKOUT)')
  process.exit(1)
}

function linkPackage(name, relativeTarget) {
  const target = join(checkout, relativeTarget)
  if (!existsSync(target)) throw new Error(`build-host: dependency target missing: ${target}`)
  const link = join(root, 'node_modules', ...name.split('/'))
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(resolve(target), resolve(link), process.platform === 'win32' ? 'junction' : 'dir')
}

console.log(`=== Linking host build dependencies (checkout: ${checkout}) ===`)
linkPackage('cordis', 'vendor/cordis')
linkPackage('cosmokit', 'vendor/cosmokit')
linkPackage('schemastery', 'vendor/schemastery')
linkPackage('@deepseek-ai/dsh-tools', 'packages/core/tools')
linkPackage('@deepseek-ai/dsh-llm', 'packages/llm/llm')
linkPackage('@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt')
linkPackage('@types/node', 'node_modules/@types/node')

const pnpmStore = join(checkout, 'node_modules', '.pnpm')
if (existsSync(pnpmStore)) {
  const spec = readdirSync(pnpmStore).find(name => name.toLowerCase().startsWith('@standard-schema+spec@'))
  if (spec) linkPackage('@standard-schema/spec', join('node_modules', '.pnpm', spec, 'node_modules', '@standard-schema', 'spec'))
}

const tsc = join(checkout, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error(`build-host: TypeScript compiler not found at ${tsc}`)
  process.exit(1)
}

console.log(typecheckOnly ? '=== Type-checking host src ===' : '=== Compiling host src → lib ===')
const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json'), ...(typecheckOnly ? ['--noEmit'] : [])], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
