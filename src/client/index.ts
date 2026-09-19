/** Input-bar editor for persistent global/workspace prompt layers. */
import { createElement, useEffect, useRef, useState } from 'react'
import { sessionIdFromProps, type SessionSlotProps } from '../client-props.js'

type ClientContext = {
  effect(fn: () => unknown, name?: string): unknown
  slots: {
    inject(key: string, fn: () => unknown): unknown
    register(entry: Record<string, unknown>, component: unknown): unknown
  }
}
type Scope = 'global' | 'workspace'
type Role = 'system' | 'user-context'
type Layer = { enabled: boolean; prompt: string; role: Role; order: number }
type PreviewEntry = { index: number; name: string; source: string; text: string }
type Preview = {
  finalSystemPrompt: string
  contextSnapshot: string
  systemSections: PreviewEntry[]
  contexts: PreviewEntry[]
}
type ApiData = {
  ok: true
  scope: Scope
  workspace?: string
  inherited?: boolean
  layer: Layer
  preview: Preview | null
  revision: string
  readOnlyReason?: string
  recoveryRequired?: boolean
}
// DSH 给 session 作用域插槽的组件传的是**顶层 prop** `sessionId`
// （web-react: `standard['sessionId'] = info.sessionId`；ui-slots 的
// SessionStandardProps 也只有 `sessionId`），没有 `session` 对象。

export const inject = ['slots']
const API = '/dsh-session-prompt/api'
const EMPTY_LAYER: Layer = { enabled: false, prompt: '', role: 'system', order: 20 }

const styles = `
.dsp-trigger{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#ccc);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.dsp-trigger:hover,.dsp-btn:hover,.dsp-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#eee);color:var(--dsw-alias-label-primary,#111)}
.dsp-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:blur(2px);padding:16px}
.dsp-box{box-sizing:border-box;width:min(780px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:12px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.15);color:var(--dsw-alias-label-primary,#111)}
.dsp-header,.dsp-tabs,.dsp-row,.dsp-actions,.dsp-meta{display:flex;align-items:center;gap:8px}.dsp-header{justify-content:space-between;margin-bottom:10px}.dsp-title{font-size:14px;font-weight:650}.dsp-tabs{margin-bottom:10px}.dsp-tab,.dsp-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1,#ccc);color:var(--dsw-alias-label-secondary,#444);border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer}.dsp-tab.active{background:var(--dsw-alias-state-business,#4a9eff);border-color:transparent;color:#fff}
.dsp-grid{display:grid;grid-template-columns:minmax(160px,1fr) minmax(160px,1fr);gap:10px;margin-bottom:10px}.dsp-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}.dsp-field select,.dsp-field input[type=number]{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111)}
.dsp-toggle{display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:10px}.dsp-path,.dsp-note{font-size:11px;color:var(--dsw-alias-label-secondary,#666);margin:5px 0 10px;overflow-wrap:anywhere}.dsp-note{line-height:1.5}.dsp-textarea{box-sizing:border-box;width:100%;min-height:150px;resize:vertical;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:8px;padding:9px;font:13px/1.5 ui-monospace,monospace}.dsp-meta{justify-content:space-between;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#666)}
.dsp-msg{margin-top:8px;font-size:12px;white-space:pre-wrap}.dsp-msg.error{color:#d44}.dsp-actions{justify-content:flex-end;margin-top:10px}.dsp-btn.primary{background:var(--dsw-alias-state-business,#4a9eff);border-color:transparent;color:#fff}.dsp-btn.danger{color:#d44}.dsp-btn:disabled,.dsp-tab:disabled{opacity:.45;cursor:not-allowed}
.dsp-preview{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l1,#ddd);padding-top:10px}.dsp-preview h3{font-size:13px;margin:0 0 8px}.dsp-preview details{border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:7px;margin:6px 0;padding:7px 9px}.dsp-preview summary{cursor:pointer;font-size:12px}.dsp-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:230px;overflow:auto;font:11px/1.45 ui-monospace,monospace;margin:8px 0 0}.dsp-empty{font-size:11px;color:var(--dsw-alias-label-secondary,#666)}
@media(max-width:620px){.dsp-grid{grid-template-columns:1fr}.dsp-meta{align-items:flex-start;flex-direction:column}}
`

async function readResponse(response: Response): Promise<ApiData> {
  let data: any
  try { data = await response.json() } catch { throw new Error(`HTTP ${response.status}`) }
  if (!response.ok || !data?.ok) throw new ApiError(response.status, data?.error || `HTTP ${response.status}`)
  return data
}

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function estimate(prompt: string) {
  const bytes = new TextEncoder().encode(prompt).byteLength
  return { chars: Array.from(prompt).length, bytes, tokens: prompt ? Math.max(1, Math.ceil(bytes / 4)) : 0 }
}

function PreviewList({ title, entries }: { title: string; entries: PreviewEntry[] }) {
  return createElement('div', null,
    createElement('h3', null, title),
    entries.length === 0
      ? createElement('div', { className: 'dsp-empty' }, '当前没有生效段落')
      : entries.map(entry => createElement('details', { key: `${title}-${entry.name}-${entry.index}` },
        createElement('summary', null, `${entry.index}. ${entry.source} 〔${entry.name}〕`),
        createElement('pre', null, entry.text),
      )),
  )
}

function SystemPromptButton(props: SessionSlotProps) {
  const sessionId = sessionIdFromProps(props)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('global')
  const [layer, setLayer] = useState<Layer>(EMPTY_LAYER)
  const [workspace, setWorkspace] = useState<string | undefined>()
  const [inherited, setInherited] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [revision, setRevision] = useState('')
  const [readOnlyReason, setReadOnlyReason] = useState<string | undefined>()
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const endpoint = `${API}?scope=${scope}&sessionId=${encodeURIComponent(sessionId)}`

  const applyData = (data: ApiData): void => {
    setLayer(data.layer)
    setWorkspace(data.workspace)
    setInherited(Boolean(data.inherited))
    setPreview(data.preview)
    setRevision(data.revision)
    setReadOnlyReason(data.readOnlyReason)
    setRecoveryRequired(Boolean(data.recoveryRequired))
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setMsg(null); setResetConfirm(false); setRevision('')
    fetch(endpoint).then(readResponse).then(data => { if (!cancelled) applyData(data) })
      .catch(error => { if (!cancelled) setMsg({ text: '读取失败: ' + String(error), error: true }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, scope, sessionId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return createElement('button', {
    type: 'button', className: 'dsp-trigger', title: '管理全局与工作区提示词注入',
    onClick: () => { setScope('global'); setMsg(null); setOpen(true) },
  }, 'Prompt 注入')

  const save = async (): Promise<void> => {
    if (layer.enabled && !layer.prompt.trim()) { setMsg({ text: '启用的段落不能为空', error: true }); return }
    setSaving(true); setMsg(null)
    try {
      const data = await readResponse(await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': `"${revision}"` },
        body: JSON.stringify({ layer }),
      }))
      applyData(data); setResetConfirm(false)
      setMsg({ text: '已保存；下一次模型请求将使用新结构 ✓' })
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      setMsg({ text: conflict ? '保存冲突：设置已被其他窗口或 DSH profile 修改。请关闭后重新打开面板，再合并你的改动。' : '保存失败: ' + String(error), error: true })
    }
    finally { setSaving(false) }
  }

  const reset = async (): Promise<void> => {
    if (!resetConfirm) { setResetConfirm(true); setMsg({ text: scope === 'global' ? '再次点击以恢复插件默认全局层。' : '再次点击以删除当前工作区覆盖。', error: true }); return }
    setSaving(true)
    try {
      const data = await readResponse(await fetch(endpoint, { method: 'DELETE', headers: { 'if-match': `"${revision}"` } }))
      applyData(data); setResetConfirm(false)
      setMsg({ text: scope === 'global' ? '全局层已恢复默认值 ✓' : '工作区覆盖已移除 ✓' })
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      setMsg({ text: conflict ? '恢复冲突：设置已在其他位置发生变化。请关闭后重新打开面板。' : '恢复失败: ' + String(error), error: true })
    }
    finally { setSaving(false) }
  }

  const stats = estimate(layer.prompt)
  const roleNote = layer.role === 'system'
    ? 'System：每次模型请求都进入真正的 system prompt；不会覆盖 DSH 原有 Agent Preset。'
    : 'User Context：DSH 将当前快照作为持久 user-role context 投影；内容变化时产生新快照，而不是每轮重复追加。'

  return createElement('div', {
    className: 'dsp-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'dsp-title',
    onClick: (event: React.MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) setOpen(false) },
  }, createElement('div', { className: 'dsp-box' },
    createElement('div', { className: 'dsp-header' },
      createElement('span', { id: 'dsp-title', className: 'dsp-title' }, 'Prompt 注入设置'),
      createElement('button', { type: 'button', className: 'dsp-btn', 'aria-label': '关闭', onClick: () => setOpen(false) }, '✕'),
    ),
    createElement('div', { className: 'dsp-tabs' },
      createElement('button', { type: 'button', className: `dsp-tab${scope === 'global' ? ' active' : ''}`, disabled: loading, onClick: () => setScope('global') }, '全局默认'),
      createElement('button', { type: 'button', className: `dsp-tab${scope === 'workspace' ? ' active' : ''}`, disabled: loading, onClick: () => setScope('workspace') }, '当前工作区'),
    ),
    scope === 'workspace' ? createElement('div', { className: 'dsp-path' }, workspace ? `工作区：${workspace}${inherited ? '（尚无覆盖）' : ''}` : '正在解析当前工作区…') : null,
    createElement('label', { className: 'dsp-toggle' },
      createElement('input', { type: 'checkbox', checked: layer.enabled, disabled: loading, onChange: event => setLayer({ ...layer, enabled: event.currentTarget.checked }) }),
      '启用这一层',
    ),
    createElement('div', { className: 'dsp-grid' },
      createElement('label', { className: 'dsp-field' }, '注入身份',
        createElement('select', { value: layer.role, disabled: loading, onChange: event => setLayer({ ...layer, role: event.currentTarget.value as Role }) },
          createElement('option', { value: 'system' }, 'System（强约束）'),
          createElement('option', { value: 'user-context' }, 'User Context（聊天上下文）'),
        ),
      ),
      createElement('label', { className: 'dsp-field' }, '排序值（越小越靠前）',
        createElement('input', { type: 'number', min: -1000, max: 1000, step: 1, value: layer.order, disabled: loading, onChange: event => setLayer({ ...layer, order: Number(event.currentTarget.value) }) }),
      ),
    ),
    createElement('div', { className: 'dsp-note' }, roleNote, ' 常用参考：Harness Identity = -100，Agent Preset = 0，工具说明通常为 100–199。'),
    readOnlyReason ? createElement('div', { className: 'dsp-msg error' }, `当前设置只读：${readOnlyReason}`) : null,
    recoveryRequired ? createElement('div', { className: 'dsp-msg error' }, '设置 JSON 已损坏；保存前会自动创建恢复备份。请先确认当前内容。') : null,
    createElement('textarea', {
      ref: textareaRef, className: 'dsp-textarea', value: layer.prompt, disabled: loading,
      placeholder: scope === 'global' ? '输入全局提示词' : '输入只对当前工作区生效的提示词',
      onChange: event => setLayer({ ...layer, prompt: event.currentTarget.value }),
    }),
    createElement('div', { className: 'dsp-meta' },
      createElement('span', null, `${stats.chars} 字符 · ${stats.bytes} bytes`),
      createElement('span', null, `约 ${stats.tokens} tokens（估算）`),
    ),
    msg ? createElement('div', { className: `dsp-msg${msg.error ? ' error' : ''}` }, msg.text) : null,
    createElement('div', { className: 'dsp-actions' },
      createElement('button', { type: 'button', className: 'dsp-btn danger', disabled: saving || loading || !revision || readOnlyReason !== undefined, onClick: () => { void reset() } }, resetConfirm ? '确认恢复' : (scope === 'global' ? '恢复默认' : '移除覆盖')),
      createElement('button', { type: 'button', className: 'dsp-btn', disabled: saving, onClick: () => setOpen(false) }, '关闭'),
      createElement('button', { type: 'button', className: 'dsp-btn primary', disabled: saving || loading || !revision || readOnlyReason !== undefined, onClick: () => { void save() } }, '保存'),
    ),
    preview ? createElement('div', { className: 'dsp-preview' },
      createElement('div', { className: 'dsp-note' }, '以下为当前已生效配置的真实装配结果；编辑后请先保存以刷新。'),
      createElement(PreviewList, { title: 'System 段落顺序与来源', entries: preview.systemSections }),
      createElement(PreviewList, { title: 'User Context 段落顺序与来源', entries: preview.contexts }),
      createElement('details', null, createElement('summary', null, '最终 System Prompt（完整文本）'), createElement('pre', null, preview.finalSystemPrompt || '（空）')),
      createElement('details', null, createElement('summary', null, '最终 User Context 快照（完整文本）'), createElement('pre', null, preview.contextSnapshot || '（空）')),
    ) : null,
  ))
}

export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.dataset.dspCss = 'dsh-session-prompt'
  style.textContent = styles
  document.head.appendChild(style)
  ctx.effect(() => {
    const dispose = ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right', id: 'dsh-session-prompt', order: -50,
    }, SystemPromptButton))
    return () => { dispose(); style.remove() }
  }, 'dsh-session-prompt: input right control')
}
