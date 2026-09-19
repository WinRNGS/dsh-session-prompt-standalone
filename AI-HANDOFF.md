# AI 维护交接说明

本文档供后续维护本插件的开发者或 Agent 使用。内容只描述仓库自身和通用 DSH 开发约定，不依赖特定计算机、用户目录或已安装 profile。

## 当前版本

当前发布线为 0.4.x，主要能力包括：

- 全局层与工作区层；
- `System` 与 `User Context` 两种 DSH 原生注入身份；
- 独立排序、启用状态和真实装配预览；
- revision / ETag 冲突检测、跨 profile 写锁与文件热重载；
- 版本化设置迁移、逐层容错、异常文件备份与未来版本只读保护；
- 模型修改设置时的 DSH 原生人工审批门。

仓库提交 `lib/` 编译产物，因此正常安装不需要构建。源码和 `lib/` 必须在同一次发布提交中保持同步。

## 文件地图

```text
src/index.ts          宿主端：设置、注入、工具、HTTP API、预览
src/client-props.ts   客户端 props 兼容处理
src/default-prompt.ts 内置默认提示词
src/client/index.ts   输入栏设置界面与装配预览
lib/                  编译后的发布产物和类型声明
scripts/              构建、类型检查辅助与冒烟测试
cordis.patch.yml      bundle 装配层
package.json          入口、客户端声明、脚本与发布文件清单
```

## DSH 插件约定

### 宿主端

插件使用 cordis 生命周期。需要释放的注册项应放入 `ctx.effect()`，并返回 disposer。硬依赖放在顶层 `inject`；`webServer` 等可选服务使用内层 `ctx.inject()`，否则缺少可选服务的 profile 会导致整个插件无法装配。

System 段使用：

```ts
ctx.systemPrompt.section({ name, order, text })
```

User Context 使用：

```ts
ctx.systemPrompt.context({ name, order, text })
```

工作区层注册在 agent scope，而不是通过文本模拟作用域。空字符串由装配器过滤。段名必须唯一，排序值必须是有限数字。

### 工具审批

`dsh_session_prompt_set` 是模型可调用的写入工具。`tools/pre-execute` 拦截器必须继续返回 `ask`，不得改成默认允许。宿主审批策略为 `never` 时，调用被拒绝属于预期行为。

### 客户端

客户端入口是浏览器 bundle，输入栏组件从顶层 prop 读取 `sessionId`，不能假定存在 `session` 对象。组件渲染异常可能被 slot 错误边界隐藏并表现为按钮消失，因此修改客户端后必须至少执行冒烟测试，并在可用环境中做一次真实界面检查。

### bundle 装配

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。补丁中的 id 必须保持唯一，包名必须能从目标 profile 解析。发布包必须包含补丁文件、宿主入口、客户端入口和类型声明。

## 设置与并发规则

- 设置格式当前为 version 2；只迁移已知旧格式，未来版本必须只读；
- 单个坏层只禁用自身，不得让整份设置回落并覆盖用户数据；
- 完整 JSON 无法解析时，保存前必须先生成异常备份；
- 所有修改都必须通过同一个写入锁和 revision 检查路径；
- HTTP 写入必须校验同源、内容类型、请求体大小、scope 和 `If-Match`；
- 文件监听只负责重新加载，不得绕过校验或写回未知格式；
- 不要删除活动中的锁文件，也不要把运行时设置加入仓库。

## 已修复的关键问题

1. 客户端错误读取嵌套 `session.sessionId`，导致输入栏按钮被错误边界静默移除；
2. 任一设置层校验失败会使整份文件回落默认值，存在后续覆盖用户数据的风险；
3. HTTP 请求体逐块转 UTF-8 会破坏恰好跨块的多字节字符；
4. 无 agent 或模板装配失败时，预览接口返回 500；
5. 使用了不存在的 system prompt 变更事件；
6. 多 profile 同时写入时缺少 revision、文件锁和外部变化监听；
7. 未知设置版本、超大文件和非法 scope 缺少保护。

这些行为已有冒烟测试覆盖。修改相关代码时应先扩充测试，再改变实现。

## 构建与验证

开发构建需要一份已经安装依赖的 DSH checkout，并通过 `DSH_CHECKOUT` 指向它：

```bash
DSH_CHECKOUT=<path-to-dsh-checkout> npm run typecheck
DSH_CHECKOUT=<path-to-dsh-checkout> npm run build
npm run test:smoke
npm pack --dry-run
npm pack
```

发布前还应执行：

```bash
git diff --check
git status --short
```

然后检查打包清单只包含 `package.json` 中 `files` 允许的源码、产物、脚本和文档。不要提交依赖目录、运行时设置、日志、本地备份、打包文件或机器专用路径。

## 发布检查表

1. 版本号、README、CHANGELOG 和编译产物一致；
2. 类型检查、构建和冒烟测试全部通过；
3. `npm pack --dry-run` 清单无本机文件；
4. 仓库扫描无凭据、令牌、私钥、本机绝对路径或外部链接；
5. staged diff 只包含本次发布内容；
6. 提交并推送后，确认远端分支提交与本地一致。
