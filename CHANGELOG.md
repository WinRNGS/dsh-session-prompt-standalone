# 更新日志

## 0.4.0

**多进程一致性、热重载与设置格式保护。**

- 设置 API 返回内容 SHA-256 revision/ETag；POST/DELETE 强制 `If-Match`，旧 revision 返回 409，
  防止多个窗口用陈旧草稿静默覆盖新设置。
- 写入增加跨 DSH profile 共享的短期锁文件；锁内重新读取磁盘并合并目标层，避免 desktop/web
  两个进程同时通过 revision 检查后互相覆盖。
- 使用 `watchFile` 监听原子替换和外部编辑；有效修改自动热重载到所有活动 agent。
- 未知 scope 返回 HTTP 400，不再把拼写错误静默当作 global。
- 设置只接受 v2 或旧 `{prompt}` 格式；未来版本进入只读保护，禁止旧插件降级覆盖。
- 设置文件总大小限制 4 MiB、工作区数量限制 512；超限文件在读取前即进入只读保护。
- UI 携带 `If-Match`、展示只读/恢复警告，并在冲突时要求重新载入后合并。
- 冒烟测试覆盖 revision 冲突、文件监听、非法 scope、未来版本和超大文件保护。

## 0.3.1

**修复分层设置与客户端入口的可靠性问题。**

- 修正 session 作用域插槽的 props：从 DSH 标准顶层 `sessionId` 取值，避免组件异常后被
  `SlotErrorBoundary` 静默退位、输入栏按钮消失。
- 设置文件改为逐层容错；单个坏层会保留原文并禁用（或仅丢弃无法识别的层），不会让有效的
  全局层和其他工作区层一起回落默认值。
- 完全无法解析的 JSON 会在下一次保存前自动复制为 `.invalid-<时间>.bak`，再写入新设置。
- HTTP 请求体改为先合并 Buffer 再统一解码，避免中文 UTF-8 字符跨数据块时产生乱码。
- 无实时 agent 时返回 `preview: null`，不再因缺少 prompt 变量导致 GET 500。
- 移除不存在的手动 `system-prompt/change` 事件；注册重建自身已负责变更通知。
- 冒烟测试新增坏层恢复、损坏文件备份、UTF-8 分块、无 agent 预览和客户端 props 回归覆盖。

## 0.3.0

**持久提示词升级为原生分层注入。**

- 新增全局层与当前工作区层；两层可同时启用，工作区由会话真实 `cwd` 识别。
- 每层可选择真正的 `System` section 或 DSH 原生 `User Context` snapshot。
- 每层可设置 `-1000..1000` 的整数排序值；工作区层通过 agent scope 注册，排序不是文本模拟。
- 输入栏入口改为分层编辑器，新增启用开关、身份选择、排序说明和工作区覆盖移除。
- 新增当前会话真实装配预览：展示 System / Context 各段顺序、来源、正文及最终完整文本。
- 旧 `{ "prompt": "..." }` 设置自动迁移到版本 2 的全局 System 层。
- 暂不伪造 Assistant 消息或任意历史深度注入，避免破坏 DSH 会话来源、恢复和工具配对。
- 内置默认提示词拆到 `src/default-prompt.ts`，宿主逻辑与默认内容分离。

## 0.2.1

**全局提示词写入加固。**

- `dsh_session_prompt_set` 改为强制经过 DSH 原生审批 UI；只有用户选择“允许一次”后才会
  永久修改全局 System Prompt，没有审批通道时自动拒绝。
- 工具结果不再回显完整提示词，只返回字符数和粗略 token 估算，避免把正文再次写入工具历史。
- system prompt section 改为只注册一次的动态文本提供器，更新时不再先注销旧段。
- 保存改为临时文件 + rename 的原子写入，并限制提示词/HTTP 请求体为 256 KiB。
- 保存和启动时检测 DSH 保留的 `{{...}}` 模板语法，避免未知变量让后续模型请求全部失败。
- HTTP API 改为精确路由，只接受 JSON 写入，拒绝跨站浏览器请求，补充 400/403/413/415/405
  状态和安全响应头。
- 编辑弹窗增加字符数、字节数、粗略 token 估算和二次确认的“恢复默认”。
- 发布包补齐 `src/` 与 `tsconfig.json`；`npm run build` 现在同时构建宿主端和客户端。

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
