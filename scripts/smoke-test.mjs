#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

function registry(target) {
  const add = (kind, entry) => {
    target[kind].push(entry)
    return () => { const index = target[kind].indexOf(entry); if (index >= 0) target[kind].splice(index, 1) }
  }
  return { section: entry => add('sections', entry), context: entry => add('contexts', entry) }
}

function createHarness(workspace) {
  const rootLayer = { sections: [
    { name: 'harness:identity', order: -100, text: 'Harness' },
    { name: 'deployment:persona', order: 0, text: 'Persona' },
  ], contexts: [] }
  const agentLayer = { sections: [], contexts: [] }
  const agent = {
    id: 'session-1', session: { header: { cwd: workspace } }, _promptLayer: agentLayer,
    ctx: { systemPrompt: registry(agentLayer) },
  }
  const events = new Map()
  const warnings = []
  const disposers = []
  let apiHandler
  let tool
  const rootPrompt = registry(rootLayer)
  rootPrompt.assemble = async ({ scope } = {}) => {
    const scoped = scope?._promptLayer ?? { sections: [], contexts: [] }
    const materialize = entries => entries.slice().sort((a, b) => a.order - b.order).map(entry => ({
      name: entry.name,
      text: typeof entry.text === 'function' ? entry.text({ scope }) : entry.text,
    }))
    return { sections: materialize([...rootLayer.sections, ...scoped.sections]), contexts: materialize([...rootLayer.contexts, ...scoped.contexts]), tools: [], variables: {} }
  }
  const ctx = {
    systemPrompt: rootPrompt,
    tools: { register(value) { tool = value; return () => {} } },
    agents: { list: () => [agent], get: id => id === agent.id ? agent : undefined },
    logger: { warn(value) { warnings.push(String(value)) } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
    on(name, fn) { events.set(name, fn); return () => events.delete(name) },
    emit() {},
    inject(_deps, callback) {
      callback({
        logger: this.logger,
        effect: fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
        webServer: { register(definition) { apiHandler = definition.handler; return () => {} } },
      })
    },
  }
  return {
    ctx, agentLayer, rootLayer, events, warnings,
    api: () => apiHandler,
    tool: () => tool,
    dispose: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

async function request(handler, method, query, body, splitAt, revision) {
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  const chunks = splitAt === undefined ? (bytes.length ? [bytes] : []) : [bytes.subarray(0, splitAt), bytes.subarray(splitAt)]
  const req = Readable.from(chunks)
  req.method = method
  req.url = `/dsh-session-prompt/api?${query}`
  req.headers = {
    ...(bytes.length ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}),
    ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }),
  }
  let status
  let responseText = ''
  const res = {
    writeHead(code) { status = code },
    setHeader() {},
    end(value = '') { responseText = String(value) },
  }
  await handler(req, res)
  return { status, body: JSON.parse(responseText) }
}

const homes = []
const harnesses = []
try {
  // Partial recovery: one malformed layer must not discard valid siblings.
  const recoveryHome = mkdtempSync(join(tmpdir(), 'dsh-session-prompt-recovery-'))
  homes.push(recoveryHome)
  const workspace = join(recoveryHome, 'workspace')
  const otherWorkspace = join(recoveryHome, 'other-workspace')
  mkdirSync(workspace)
  mkdirSync(otherWorkspace)
  writeFileSync(join(recoveryHome, 'dsh-session-prompt.json'), JSON.stringify({
    version: 2,
    global: { enabled: true, prompt: 'valid global', role: 'system', order: 10 },
    workspaces: {
      broken: { path: workspace, enabled: true, prompt: 'literal {{cat}}', role: 'user-context', order: 20 },
      healthy: { path: otherWorkspace, enabled: true, prompt: 'other valid', role: 'system', order: 30 },
    },
  }))
  process.env.DSH_HOME = recoveryHome
  const { apply } = await import(`../lib/index.js?recovery=${Date.now()}`)
  const harness = createHarness(workspace)
  harnesses.push(harness)
  apply(harness.ctx)
  assert.equal(harness.rootLayer.sections.find(entry => entry.name === 'session-prompt:persistent').text(), 'valid global')
  assert.equal(harness.agentLayer.contexts.find(entry => entry.name === 'session-prompt:workspace-context').text(), '')
  assert(harness.warnings.some(message => message.includes('preserved but disabled')))

  let response = await request(harness.api(), 'GET', 'scope=workspace&sessionId=session-1')
  assert.equal(response.status, 200)
  assert.equal(response.body.inherited, false)
  assert.equal(response.body.layer.enabled, false)
  assert.equal(response.body.layer.prompt, 'literal {{cat}}')
  let currentRevision = response.body.revision

  // Split inside the three-byte UTF-8 encoding of 猫; the saved value must remain intact.
  const unicodeLayer = { enabled: true, prompt: '你是一只猫娘', role: 'user-context', order: -5 }
  const encoded = Buffer.from(JSON.stringify({ layer: unicodeLayer }))
  const catStart = encoded.indexOf(Buffer.from('猫'))
  response = await request(harness.api(), 'POST', 'scope=workspace&sessionId=session-1', { layer: unicodeLayer }, catStart + 1, currentRevision)
  assert.equal(response.status, 200)
  currentRevision = response.body.revision
  assert.equal(harness.agentLayer.contexts.find(entry => entry.name === 'session-prompt:workspace-context').text(), unicodeLayer.prompt)
  const saved = JSON.parse(readFileSync(join(recoveryHome, 'dsh-session-prompt.json'), 'utf8'))
  assert.equal(saved.version, 2)
  assert(Object.values(saved.workspaces).some(layer => layer.prompt === 'other valid'))
  assert(Object.values(saved.workspaces).some(layer => layer.prompt === unicodeLayer.prompt))

  // Global editing remains available while no live agent exists; preview degrades to null, not HTTP 500.
  response = await request(harness.api(), 'GET', 'scope=global&sessionId=missing')
  assert.equal(response.status, 200)
  assert.equal(response.body.preview, null)

  response = await request(harness.api(), 'GET', 'scope=workspcae&sessionId=session-1')
  assert.equal(response.status, 400)

  // External writes are hot-reloaded; a stale UI revision must not overwrite them.
  const externallyChanged = JSON.parse(readFileSync(join(recoveryHome, 'dsh-session-prompt.json'), 'utf8'))
  externallyChanged.global.prompt = 'external global'
  writeFileSync(join(recoveryHome, 'dsh-session-prompt.json'), JSON.stringify(externallyChanged, null, 2) + '\n')
  await new Promise(resolve => setTimeout(resolve, 800))
  assert.equal(harness.rootLayer.sections.find(entry => entry.name === 'session-prompt:persistent').text(), 'external global')
  response = await request(harness.api(), 'POST', 'scope=workspace&sessionId=session-1', { layer: unicodeLayer }, undefined, currentRevision)
  assert.equal(response.status, 409)
  assert.equal(JSON.parse(readFileSync(join(recoveryHome, 'dsh-session-prompt.json'), 'utf8')).global.prompt, 'external global')
  response = await request(harness.api(), 'GET', 'scope=workspace&sessionId=session-1')
  currentRevision = response.body.revision

  const decision = await harness.events.get('tools/pre-execute')({ name: 'dsh_session_prompt_set' }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'ask')
  assert.equal(typeof harness.tool().execute, 'function')
  response = await request(harness.api(), 'DELETE', 'scope=workspace&sessionId=session-1', undefined, undefined, currentRevision)
  assert.equal(response.status, 200)
  assert.equal(response.body.inherited, true)

  // v0.2 {prompt} migration still produces the global system layer.
  const migrationHome = mkdtempSync(join(tmpdir(), 'dsh-session-prompt-migration-'))
  homes.push(migrationHome)
  const migrationWorkspace = join(migrationHome, 'workspace')
  mkdirSync(migrationWorkspace)
  writeFileSync(join(migrationHome, 'dsh-session-prompt.json'), JSON.stringify({ prompt: 'legacy global' }))
  process.env.DSH_HOME = migrationHome
  const migratedModule = await import(`../lib/index.js?migration=${Date.now()}`)
  const migratedHarness = createHarness(migrationWorkspace)
  harnesses.push(migratedHarness)
  migratedModule.apply(migratedHarness.ctx)
  assert.equal(migratedHarness.rootLayer.sections.find(entry => entry.name === 'session-prompt:persistent').text(), 'legacy global')

  // Two profile instances racing on one revision: exactly one write wins.
  const raceHome = mkdtempSync(join(tmpdir(), 'dsh-session-prompt-race-'))
  homes.push(raceHome)
  const raceWorkspace = join(raceHome, 'workspace')
  mkdirSync(raceWorkspace)
  writeFileSync(join(raceHome, 'dsh-session-prompt.json'), JSON.stringify({
    version: 2,
    global: { enabled: true, prompt: 'race base', role: 'system', order: 10 },
    workspaces: {},
  }))
  process.env.DSH_HOME = raceHome
  const raceModuleA = await import(`../lib/index.js?raceA=${Date.now()}`)
  const raceModuleB = await import(`../lib/index.js?raceB=${Date.now()}`)
  const raceHarnessA = createHarness(raceWorkspace)
  const raceHarnessB = createHarness(raceWorkspace)
  harnesses.push(raceHarnessA, raceHarnessB)
  raceModuleA.apply(raceHarnessA.ctx)
  raceModuleB.apply(raceHarnessB.ctx)
  const raceReadA = await request(raceHarnessA.api(), 'GET', 'scope=global&sessionId=session-1')
  const raceReadB = await request(raceHarnessB.api(), 'GET', 'scope=global&sessionId=session-1')
  assert.equal(raceReadA.body.revision, raceReadB.body.revision)
  const raceResults = await Promise.all([
    request(raceHarnessA.api(), 'POST', 'scope=global&sessionId=session-1', {
      layer: { enabled: true, prompt: 'race A', role: 'system', order: 10 },
    }, undefined, raceReadA.body.revision),
    request(raceHarnessB.api(), 'POST', 'scope=global&sessionId=session-1', {
      layer: { enabled: true, prompt: 'race B', role: 'system', order: 10 },
    }, undefined, raceReadB.body.revision),
  ])
  assert.deepEqual(raceResults.map(result => result.status).sort(), [200, 409])
  assert(['race A', 'race B'].includes(JSON.parse(readFileSync(join(raceHome, 'dsh-session-prompt.json'), 'utf8')).global.prompt))

  // Completely unreadable JSON is backed up before the first later save.
  const corruptHome = mkdtempSync(join(tmpdir(), 'dsh-session-prompt-corrupt-'))
  homes.push(corruptHome)
  const corruptWorkspace = join(corruptHome, 'workspace')
  mkdirSync(corruptWorkspace)
  writeFileSync(join(corruptHome, 'dsh-session-prompt.json'), '{ broken json')
  process.env.DSH_HOME = corruptHome
  const corruptModule = await import(`../lib/index.js?corrupt=${Date.now()}`)
  const corruptHarness = createHarness(corruptWorkspace)
  harnesses.push(corruptHarness)
  corruptModule.apply(corruptHarness.ctx)
  const toolResult = await corruptHarness.tool().execute({ prompt: 'recovered global' })
  assert.match(toolResult, /^OK:/)
  assert(readdirSync(corruptHome).some(name => /^dsh-session-prompt\.json\.invalid-\d+\.bak$/.test(name)))
  assert.equal(JSON.parse(readFileSync(join(corruptHome, 'dsh-session-prompt.json'), 'utf8')).global.prompt, 'recovered global')

  // Future schemas are read-only instead of being downgraded and overwritten.
  const futureHome = mkdtempSync(join(tmpdir(), 'dsh-session-prompt-future-'))
  homes.push(futureHome)
  const futureWorkspace = join(futureHome, 'workspace')
  mkdirSync(futureWorkspace)
  writeFileSync(join(futureHome, 'dsh-session-prompt.json'), JSON.stringify({ version: 3, future: true }))
  process.env.DSH_HOME = futureHome
  const futureModule = await import(`../lib/index.js?future=${Date.now()}`)
  const futureHarness = createHarness(futureWorkspace)
  harnesses.push(futureHarness)
  futureModule.apply(futureHarness.ctx)
  response = await request(futureHarness.api(), 'GET', 'scope=global&sessionId=session-1')
  assert.match(response.body.readOnlyReason, /unsupported settings version/)
  assert.match(await futureHarness.tool().execute({ prompt: 'must not overwrite' }), /^ERROR:/)
  assert.equal(JSON.parse(readFileSync(join(futureHome, 'dsh-session-prompt.json'), 'utf8')).version, 3)

  // Oversized files are rejected before JSON parsing or whole-file allocation.
  const oversizedHome = mkdtempSync(join(tmpdir(), 'dsh-session-prompt-oversized-'))
  homes.push(oversizedHome)
  const oversizedWorkspace = join(oversizedHome, 'workspace')
  mkdirSync(oversizedWorkspace)
  writeFileSync(join(oversizedHome, 'dsh-session-prompt.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x20))
  process.env.DSH_HOME = oversizedHome
  const oversizedModule = await import(`../lib/index.js?oversized=${Date.now()}`)
  const oversizedHarness = createHarness(oversizedWorkspace)
  harnesses.push(oversizedHarness)
  oversizedModule.apply(oversizedHarness.ctx)
  response = await request(oversizedHarness.api(), 'GET', 'scope=global&sessionId=session-1')
  assert.match(response.body.readOnlyReason, /limit/)

  // Regression guard for strict session slot props (BUG-1).
  const { sessionIdFromProps } = await import('../lib/client-props.js')
  assert.equal(sessionIdFromProps({ sessionId: 'session-1' }), 'session-1')
  assert.throws(() => sessionIdFromProps({ session: { sessionId: 'wrong-shape' } }), /top-level sessionId/)

  console.log('smoke-test: revision conflicts, file watch, scope validation, version/size guards, recovery, migration, UTF-8, injection, approval and client props passed')
} finally {
  for (const harness of harnesses.reverse()) harness.dispose()
  for (const home of homes) rmSync(home, { recursive: true, force: true })
}
