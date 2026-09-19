# @dsh-external/dsh-session-prompt

为 DeepSeek Harness 提供持久提示词注入。插件保留 DSH 原有的 Harness Identity、Agent Preset 和工具说明，并在其基础上增加可管理的全局层与工作区层。

仓库已经包含编译后的 `lib/`，普通用户和安装 Agent 不需要准备开发环境，也不需要先执行构建。

## 功能

- 全局默认提示词与当前工作区提示词可以同时启用；
- 每层可选择 `System` 或 `User Context` 身份；
- 每层可独立设置启用状态和排序值；
- 设置长期保存在 DSH 数据目录中，重启和上下文压缩后仍会重新装配；
- 设置界面可预览当前会话的段落顺序、来源与最终文本；
- 模型发起的修改必须经过 DSH 原生审批，不能静默改写设置；
- 支持多 profile 并发保护、revision 冲突检测和外部文件热重载；
- 提供版本化设置迁移、异常数据保护和恢复默认。

## 快速安装

### 方式一：直接从 Git 仓库安装

这是用户和安装 Agent 的推荐方式：

```bash
dsh plugin --profile web add "github:WinRNGS/dsh-session-prompt-standalone#main"
```

如果实际运行的是其他 profile，把 `web` 换成对应名称。安装完成后重启该 DSH profile。

### 方式二：下载后本地安装

```bash
gh repo clone WinRNGS/dsh-session-prompt-standalone
cd dsh-session-prompt-standalone
dsh plugin --profile web add .
```

Windows 上建议把仓库放在不含空格的目录中，以避开部分旧版 DSH CLI 转发本地路径时的参数解析问题。

### 方式三：安装打包文件

在仓库目录执行：

```bash
npm pack
dsh plugin --profile web add ./dsh-external-dsh-session-prompt-0.4.0.tgz
```

安装 Agent 可以直接执行方式一；若环境禁止 Git 依赖，则下载仓库后执行方式二。无需修改 DSH 源码或手工复制 `lib/`。

## 使用

在会话输入栏右侧点击 **Prompt 注入**：

1. 选择“全局默认”或“当前工作区”；
2. 选择 `System` 或 `User Context`；
3. 设置排序值、启用状态和正文；
4. 保存，下一次模型请求生效；
5. 展开装配预览，检查顺序、来源与最终文本。

“恢复默认”会恢复插件配置中的初始全局值；“移除覆盖”只删除当前工作区层。

模型可以调用 `dsh_session_prompt_set` 提议修改全局正文，但真正写入前必须经过 DSH 原生审批界面的人工确认。工具结果不会重复回显完整提示词。

## 注入身份

| 身份 | DSH 原生机制 | 行为 |
|---|---|---|
| `System` | `systemPrompt.section()` | 每次模型请求时重新装配进真正的 system prompt；恢复会话或压缩上下文后仍然存在。 |
| `User Context` | `systemPrompt.context()` | 生成带来源信息的 user-role runtime-context 快照；只在内容变化时投影新快照，不会每轮机械重复追加。 |

`User Context` 是 DSH 当前最接近“聊天中注入”的原生通道，但不是任意历史深度插入。插件不伪造 `Assistant` 消息，也不提供“倒数第 N 条消息”注入，以免破坏会话恢复、工具调用与消息配对。

## 层级与排序

全局层和工作区层可以同时生效。工作区层使用当前会话工作目录的规范化路径作为内部键，浏览器不能自行指定其他工作区路径。

排序值越小越靠前。参考顺序：

- Harness Identity：`-100`
- Agent Preset / Persona：`0`
- 插件全局层：`10`
- 插件工作区层：`20`
- DSH 工具说明：通常为 `100–199`

System 和 User Context 属于两个独立序列，排序值只在各自序列内比较。

## 设置与安全

设置保存在 DSH 数据目录下的 `dsh-session-prompt.json`，只在本地读写。当前格式版本为 2：

```json
{
  "version": 2,
  "global": {
    "enabled": true,
    "prompt": "全局规则",
    "role": "system",
    "order": 10
  },
  "workspaces": {
    "normalized-workspace-key": {
      "path": "workspace-path",
      "enabled": true,
      "prompt": "项目规则",
      "role": "user-context",
      "order": 20
    }
  }
}
```

- 单段正文上限 256 KiB，请求体上限 1 MiB，设置文件上限 4 MiB；
- 最多保存 512 个工作区层；
- 写入使用临时文件与原子替换，并用跨 profile 文件锁保护；
- API 使用 revision 与 `If-Match` 检测陈旧草稿，冲突返回 409；
- 写入接口只接受同源 JSON 请求；
- 外部文件变化会触发热重载；未知的新格式版本或超大文件进入只读保护；
- 单个无效层会保留可恢复正文但自动禁用，不影响其他有效层；
- 整份 JSON 损坏时，下次保存前会生成带时间标记的备份；
- DSH 会解释完整的双花括号模板变量。插件定位为纯文本注入，因此拒绝这种结构，避免未知变量导致后续模型请求失败。

提示词只能影响模型行为，不能保证任何模型百分之百遵循。

## 可选初始值

在 bundle 配置中设置初始全局提示词：

```yaml
- insert:
    - id: dsh-session-prompt
      name: '@dsh-external/dsh-session-prompt'
      config:
        prompt: '你的初始全局提示词'
```

设置文件优先于该初始值。“恢复默认”会回到此值；未配置时使用插件内置文本。

## 更新与卸载

更新时重新执行对应的安装命令，然后重启 DSH。设置文件独立于插件包，正常更新不会清除已有提示词。

卸载请使用 DSH 自身的插件管理命令。卸载插件不会自动删除设置文件，便于重新安装后恢复；如需彻底清理，应由用户自行确认后删除该设置文件。

## 开发与验证

只有修改 TypeScript 源码时才需要一份已经安装依赖的 DSH checkout：

```bash
DSH_CHECKOUT=<path-to-dsh-checkout> npm run typecheck
DSH_CHECKOUT=<path-to-dsh-checkout> npm run build
npm run test:smoke
npm pack
```

PowerShell 可先设置同名环境变量，再执行这些命令。构建脚本会临时链接 DSH workspace 依赖；这些依赖不会进入仓库或发布包。

主要目录：

```text
src/index.ts          宿主端：设置、注入、工具、API、预览
src/default-prompt.ts 内置默认提示词
src/client/index.ts   输入栏设置界面与预览
lib/                  已编译、可直接安装的发布产物
scripts/              构建与冒烟测试
cordis.patch.yml      DSH bundle 装配层
```

## License

MIT
