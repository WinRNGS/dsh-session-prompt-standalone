/**
 * @dsh-external/dsh-session-prompt — 双通道自定义指令注入器。
 *
 * 方案 C：
 * 1. 持久层：注册一段静态 system prompt section（不替换默认 deployment:persona），
 *    每次请求都会重新组装，因此上下文压缩后依然有效。
 * 2. 可见层：agent/session-start 时用 agent.inject() 把同一段内容作为 plugin
 *    来源的上下文消息注入新会话，用户能在聊天里看到。
 *
 * 配置：~/.dsh/dsh-session-prompt.json（UI / dsh_session_prompt_set 写入）。
 */
import { Context } from 'cordis'
import type SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const name = 'dsh-session-prompt'
export const inject = ['systemPrompt', 'tools', 'webServer', 'agents']

export interface Config {
  /** 装配时提供的初始提示词；运行时会优先使用已保存的设置文件。 */
  prompt?: string
}

/** 默认提示词：用户可通过工具或配置覆盖。 */
const DEFAULT_PROMPT = 'You are a helpful software engineer assistant.'

/** 持久 system prompt 段名：唯一且稳定。 */
const SECTION_NAME = 'session-prompt:persistent'
/** 放在默认 persona（0）之后、工具引导（100+）之前，不覆盖官方 persona。 */
const SECTION_ORDER = 10

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SETTINGS_FILE = join(DSH_HOME, 'dsh-session-prompt.json')
/** 已注入过的会话 id，避免同一会话重复插入。 */
const injectedSessions: string[] = []

/** 会话关闭后从去重表移除，避免内存只增不减。 */
function forgetSession(sessionId: string): void {
  const index = injectedSessions.indexOf(sessionId)
  if (index >= 0) injectedSessions.splice(index, 1)
}

/** 从设置文件读取已保存的 prompt；文件不存在/损坏时返回 undefined。 */
function loadSavedPrompt(): string | undefined {
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    const prompt = typeof data?.prompt === 'string' ? data.prompt.trim() : ''
    return prompt || undefined
  } catch {
    return undefined
  }
}

/** 把当前 prompt 持久化到设置文件。 */
function savePrompt(prompt: string): void {
  mkdirSync(DSH_HOME, { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify({ prompt }, null, 2) + '\n', 'utf8')
}

/** 读取 HTTP 请求体（客户端 UI 保存 prompt 时使用）。 */
function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString('utf8') })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export function apply(ctx: Context, config: Config = {}): void {
  const initialPrompt: string = (loadSavedPrompt() ?? config.prompt ?? DEFAULT_PROMPT).trim()
  if (!initialPrompt) {
    throw new Error(`${name}: prompt cannot be empty`)
  }

  let currentPrompt = initialPrompt as string
  let disposeSection: (() => void) | null = null

  // 持久层：静态 system prompt section，压缩不影响。
  const installSection = (): void => {
    if (disposeSection) disposeSection()
    disposeSection = ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: currentPrompt,
    })
  }

  ctx.effect(() => {
    installSection()
    return () => {
      disposeSection?.()
      disposeSection = null
    }
  });

  // 可见层：官方推荐的会话起始注入点，第一轮之前 seed 上下文。
  (ctx as any).on('agent/session-start', (payload: any) => {
    try {
      const agent = payload?.agent
      if (!agent?.session || !agent?.inject) return
      const session = agent.session
      if (injectedSessions.includes(session.id)) return
      // 已有用户消息 = 恢复/续聊，跳过；只处理全新会话。
      if (session.events.some((e: any) => e.type === 'user/message')) return
      // 只注入顶层用户会话，不打扰子代理/subagent。
      if (session.header?.delegationDepth !== 0) return

      agent.inject({
        id: `dsh-session-prompt-${session.id}-${Date.now()}`,
        role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-session-prompt' },
        content: [{ type: 'text', text: currentPrompt }],
      })
      injectedSessions.push(session.id)
    } catch (error) {
      // 注入失败不应拖垮会话启动。
      console.error(`[${name}] inject preamble failed:`, error)
    }
  });

  // 会话关闭后清理去重记录。
  (ctx as any).on('session/disposed', (session: any) => {
    if (session?.id) forgetSession(session.id)
  });

  // 管理工具：修改并持久化提示词。
  ctx.effect(() => (ctx as any).tools.register({
    name: 'dsh_session_prompt_set',
    description: 'Set the custom instructions injected into every new DSH session.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'New custom instruction text' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: unknown) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return 'ERROR: arguments must be an object containing prompt'
      }
      const next = typeof (args as { prompt?: unknown }).prompt === 'string'
        ? (args as { prompt: string }).prompt.trim()
        : ''
      if (!next) return `ERROR: prompt cannot be empty`
      currentPrompt = next
      savePrompt(next)
      installSection()
      return `OK: 自定义指令已更新：${next}`
    },
  } as any), 'dsh-session-prompt: set tool')

  // Web UI 用的同源 API：GET 读取当前 prompt，POST/PUT 保存新 prompt。
  ctx.effect(() => (ctx as any).webServer.register({
    kind: 'prefix',
    path: '/dsh-session-prompt/api',
    handler: async (req: any, res: any) => {
      const send = (code: number, obj: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.replace(/^\/dsh-session-prompt\/api/, '') || '/'
        if (req.method === 'GET' && path === '/') {
          return send(200, { ok: true, prompt: currentPrompt })
        }
        if ((req.method === 'POST' || req.method === 'PUT') && path === '/') {
          const body = JSON.parse(await readBody(req))
          const next = String(body?.prompt ?? '').trim()
          if (!next) return send(400, { ok: false, error: 'prompt cannot be empty' })
          currentPrompt = next
          savePrompt(next)
          installSection()
          return send(200, { ok: true, prompt: currentPrompt })
        }
        return send(404, { ok: false, error: 'not found: ' + path })
      } catch (e) {
        return send(500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  }), 'dsh-session-prompt: api')
}
