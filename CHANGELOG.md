# 更新日志

## 0.2.0

**设计固化：只保留 system prompt 段通道。**

- 删除旧的「可见层」：不再在 `agent/session-start` 时用 `agent.inject()` 往会话里塞
  `role: 'user'` 的上下文消息，也不再维护 `injectedSessions` 去重表与会话销毁监听。
- 原因（详见 README「为什么只有一个通道」）：
  1. **静默失灵**：该层依赖 `session.events`，DSH `0.1.5-rc.1` 移除了这个 getter
     （改为 `snapshotEvents()` / `ownEvents()` / `eventAt()`），守卫抛 `TypeError`
     后被插件自身 `try/catch` 吞掉 → 所有新会话都不再有上下文注入，日志里毫无痕迹。
  2. **重复投递**：同一文本既在 system 段、又作为历史 user 消息存在，每次请求发两遍。
  3. **快照漂移**：改词后段即时生效，历史里那条消息仍是旧文本 → 恢复的会话同时看到两套矛盾指令。
  4. **重复注入**：去重表是模块级内存数组，插件热重载（新模块实例）或 DSH 重启即清空，
     未落盘的注入不写日志 → 曾出现同一会话注入 2~3 份。
- 加固：
  - `config.prompt` 为空串等空值不再抛错（装配期抛错会让整个插件装配失败），一律回落内置默认值。
  - `webServer` 改为内层 `ctx.inject(['webServer'], …)`，非 web profile（headless/CLI）
    仍能装配 system prompt 段与管理工具，只是没有 UI/HTTP API。
  - 客户端 `fetch` 增加 `response.ok` 判定，错误响应不再显示为 `SyntaxError`。
  - 修正 `dsh.client.inject` 中在 DSH 0.1.5 运行时已不存在的包名
    （`dsh-client-runtime` / `dsh-client-ui-slots` → `dsh-client-ui-renderer` / `dsh-client-ui-conversation`）。
- 内置一份通用「AI 工程 Agent 工作守则」作为默认提示词。

## 0.1.0

- 初版：双通道注入（system prompt 静态段 + `agent/session-start` 上下文消息），
  输入栏 System Prompt 按钮、`dsh_session_prompt_set` 工具、`~/.dsh/dsh-session-prompt.json` 持久化。
