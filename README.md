# @dsh-external/dsh-session-prompt

> DSH 插件：把你自定义的一段指令，**作为 system prompt 固定段**注入每一个会话。

它注册一段静态 system prompt（段名 `session-prompt:persistent`，顺序 10，紧跟官方
`deployment:persona` 之后），因此：

- ✅ **不会被上下文压缩丢掉**：每次模型请求都重新组装，长会话、压缩、恢复后依然有效；
- ✅ **不覆盖官方 persona**：它是独立的一段，与官方人格提示词并存；
- ✅ **不污染聊天记录**：不会在会话里插入假的 user 消息，也不会把同一段文本发两遍；
- ✅ **全局即时生效**：改完提示词，所有会话（含进行中的）下一轮请求就用新内容；
- ✅ **可随时可视化修改**：输入栏有一个 **System Prompt** 按钮，点开即可编辑保存；
- ✅ **也支持让模型自己改**：内置工具 `dsh_session_prompt_set`，直接对它说"把 system prompt 设置为：…"。

内容持久化在 `~/.dsh/dsh-session-prompt.json`，插件只在本地读写，不联网。

---

## 效果示例

设置一段"工程 Agent 工作守则"后，每个会话的 system prompt 会变成：

```
You are an AI agent powered by DeepSeek Harness.      ← 官方 persona（未改动）
You are a coding agent powered by <model>.
# AI 工程 Agent 工作守则                              ← 本插件注入的段
## 优先级
执行任务时遵循：
...
```

插件自带一份通用的「AI 工程 Agent 工作守则」作为默认提示词（见 `src/index.ts` 的
`DEFAULT_PROMPT`），装上就能用，也可以整段替换成你自己的。

---

## 工作原理

| 通道 | 落地位置 | 说明 |
|---|---|---|
| **静态 system prompt 段** | `ctx.systemPrompt.section({ name: 'session-prompt:persistent', order: 10, text })` | 唯一注入通道。每轮请求重新组装；`order: 10` 位于 persona（0）之后、工具引导（100+）之前 |
| **编辑入口** | 输入栏 `conversation.input.right`（模型选择器左侧）→ 同源 API `/dsh-session-prompt/api` | 打开模态框读取当前文本；保存即写文件 + 热替换段 |
| **工具入口** | `dsh_session_prompt_set` | 让模型/脚本直接改写 |
| **持久化** | `~/.dsh/dsh-session-prompt.json` | `{ "prompt": "…" }`，UTF-8 |

优先级：`~/.dsh/dsh-session-prompt.json` > `cordis.patch.yml` 的 `config.prompt` > 内置默认值。
（三处都为空时回落内置默认值，不会因为空值导致装配失败。）

### 为什么只有一个通道（v0.2.0 的设计决定）

0.1.0 曾是"双通道"：除了 system prompt 段，还在 `agent/session-start` 时用
`agent.inject()` 往会话里塞一条 `role: 'user'` 的上下文消息（让用户"在聊天里看到"）。
该做法有四个硬伤，已在 0.2.0 移除：

1. **静默失灵**：它依赖 `session.events`，而 DSH `0.1.5-rc.1` 移除了这个 getter
   （改为 `snapshotEvents()` / `ownEvents()` / `eventAt()`）。守卫抛 `TypeError` 后被插件
   自身的 `try/catch` 吞掉 → 所有新会话都不再有注入，日志里毫无痕迹。
2. **重复投递**：同一文本既在 system 段、又作为历史 user 消息，每次请求发两遍（token 翻倍）。
3. **快照漂移**：改词后段即时生效，而历史里那条消息仍是旧文本 → 恢复的会话同时看到两套矛盾指令。
4. **重复注入**：去重表是模块级内存数组，插件热重载（新模块实例）或 DSH 重启即清空，
   未落盘的注入不写日志 → 曾出现同一会话注入 2~3 份。

结论：**system prompt 段是更强、更省、更稳的通道**，所以只保留它。

---

## 环境要求

- DSH（DeepSeek Harness）本体，`@deepseek-ai/dsh-system-prompt` / `@deepseek-ai/dsh-tools`
  在 `>=0.0.1-rc <2` 区间内（已在 `0.1.5-rc.1` 上验证）；
- 想用**输入栏按钮**，运行 profile 需要 web 形态（有 `webServer` 服务）。
  非 web profile（headless / CLI）下插件仍会装配段与工具，只是没有 UI 与 HTTP API。

---

## 安装

### 方式 A：从本仓库目录直接装（最简单）

```bash
git clone <本仓库地址> dsh-session-prompt
dsh plugin --profile web add "$(pwd)/dsh-session-prompt"
```

`dsh plugin --profile <name> add <spec>` 是 pnpm 的转发器；装完会自动把声明了
`dsh.bundle` 的依赖追加进该 profile 的 `dsh.profile.bundles` 层栈。

### 方式 B：用打包好的 tgz（Release 附件）

```bash
dsh plugin --profile web add ./dsh-external-dsh-session-prompt-0.2.0.tgz
```

### 方式 C：作为 git 依赖写进 profile

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "@dsh-external/dsh-session-prompt": "github:<你的账号>/<本仓库>#main"
  }
}
```

改完执行 `dsh plugin --profile <profile> install`（或直接 `pnpm install`）。
本仓库已提交构建产物 `lib/`，安装端无需任何构建步骤。

### 方式 D：开发态运行时注入（需要 dsh-super-injector）

```text
dev_inject_plugin <本仓库的绝对路径>
```

装好后**重启 DSH**（或在支持热重载的环境里热重载插件）即可生效。

### 卸载

```bash
dsh plugin --profile web remove @dsh-external/dsh-session-prompt
```

（会同时从 `bundles` 层栈移除；`~/.dsh/dsh-session-prompt.json` 是用户数据，不会被删。）

---

## 使用

1. **输入栏按钮**：在输入框右侧功能区、**模型选择器左侧**点 **System Prompt** →
   弹窗显示当前文本 → 编辑 → 保存。保存后所有会话下一轮请求即生效。
2. **让模型改**：直接说 `把 system prompt 设置为：……`（模型会调用 `dsh_session_prompt_set`）。
3. **手改文件**：编辑 `~/.dsh/dsh-session-prompt.json` 的 `prompt` 字段，重启或热重载插件后生效。

写入的文本会以 system prompt 段 `session-prompt:persistent` 的形式出现在每次请求中；
它**不会**出现在聊天记录里——这是设计行为，不是故障。

---

## 配置（可选）

在 `cordis.patch.yml`（本插件包内，或 profile 的 patch 层）里给装配层一个初始值：

```yaml
- insert:
    - id: dsh-session-prompt
      name: '@dsh-external/dsh-session-prompt'
      config:
        prompt: '你的初始提示词'
```

注意：一旦用户在 UI/工具里保存过，`~/.dsh/dsh-session-prompt.json` 会优先于这里的 `config.prompt`。

---

## 目录结构

```
.
├── cordis.patch.yml          # bundle 层：把插件 insert 进 cordis loader
├── package.json              # dsh.bundle / dsh.client 声明、exports、peerDependencies
├── lib/                      # 构建产物（已入库，装完即用）
│   ├── index.js              #   宿主侧：system prompt 段 + 工具 + 可选 HTTP API
│   ├── client.js             #   浏览器侧：输入栏 System Prompt 按钮与模态框
│   └── types/                #   类型声明
├── src/
│   ├── index.ts              # 宿主侧源码（含内置默认提示词 DEFAULT_PROMPT）
│   └── client/index.ts       # 客户端源码
├── scripts/
│   ├── build.sh              # 用 DSH checkout 的 tsc 编译宿主侧
│   └── build-client.mjs      # 用 DSH checkout 的 tsdown 打包客户端
├── tsconfig.json
├── tsdown.config.ts
├── CHANGELOG.md
└── LICENSE
```

---

## 从源码构建

需要一份 DSH 源码 checkout（含 `packages/` 与 `node_modules/.bin/tsc`）：

```bash
DSH_CHECKOUT=/path/to/dsh-checkout bash scripts/build.sh          # 宿主侧 → lib/
DSH_CHECKOUT=/path/to/dsh-checkout node scripts/build-client.mjs  # 客户端 → lib/client.js
npm pack                                                          # 产出 tgz
```

构建脚本会用 junction/symlink 把 checkout 里的 `cordis`、`@deepseek-ai/dsh-tools`、
`@deepseek-ai/dsh-system-prompt` 等链接到插件的 `node_modules/`（该目录不入库）。

---

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 输入栏看不到 **System Prompt** 按钮 | ① profile 是 web 形态吗；② `lib/client.js` 是否存在；③ 刷新页面（客户端插件支持 HMR 时自动重载）。 |
| 点按钮提示 `读取失败: HTTP 403` / `保存失败: HTTP 403` | 请求被宿主网关拒绝。**DSH Desktop 2.0.9 起 webserver 被桌面层加了一层门禁**：只有 Electron 窗口（渲染进程会自动附带 `x-dsh-desktop-renderer` 头）的请求放行；用**外部浏览器**打开同一个 `http://127.0.0.1:<port>` 时，所有路由（不只本插件）都会 403。请在桌面窗口内使用。 |
| 提示词改了但没生效 | 段在每轮请求重新组装，**下一条消息**才生效；若改的是 `cordis.patch.yml` 而非 UI，需要重启或热重载插件。 |
| system prompt 里看不到这段 | 确认该 profile 已装配本插件（`dsh.profile.bundles` 里有 `@dsh-external/dsh-session-prompt`），并确认当次请求里有段名 `session-prompt:persistent`。 |
| 提示词太长怎么办 | 段是每次请求都发的静态文本（对前缀缓存友好），token 成本与长度成正比，建议控制在几百字内。 |

---

## 隐私与数据

- 只读写本地文件 `~/.dsh/dsh-session-prompt.json`（可用 `DSH_HOME` 改位置）；
- 不发起任何网络请求，不上报任何内容；
- 暴露在端口上的 `/dsh-session-prompt/api` 只返回/接收这段文本，且受宿主既有网关保护。

---

## 开发与贡献

- 宿主侧：`src/index.ts`（`inject = ['systemPrompt', 'tools']`，`webServer` 走内层 `ctx.inject`）；
- 客户端：`src/client/index.ts`（注册 `conversation.input.right` 插槽条目）；
- 改完请执行 `bash scripts/build.sh` + `node scripts/build-client.mjs`，并把 `lib/` 一起提交（本仓库以"装完即用"为准）。

## License

MIT，见 [LICENSE](LICENSE)。

---

## English summary

`@dsh-external/dsh-session-prompt` injects a user-defined instruction block into **every**
DSH session as a **static system-prompt section** (`session-prompt:persistent`, order 10).
The text survives context compaction, never replaces the official persona, never appears as a
fake chat message, and applies to all sessions on the next request. Edit it from the
**System Prompt** button left of the model selector in the input bar, via the
`dsh_session_prompt_set` tool, or by editing `~/.dsh/dsh-session-prompt.json`.
Version 0.2.0 removed the legacy context-injection channel (it relied on `session.events`,
which DSH `0.1.5-rc.1` dropped; it also double-billed tokens and drifted from the live setting).
