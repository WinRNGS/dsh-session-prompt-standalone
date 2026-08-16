# @dsh-external/dsh-session-prompt

在每个 DSH **新会话开始前**，自动往聊天记录里插入一条可自定义的 AI/系统回复，作为上下文前置提示词；并在**输入框工具区**（模型选择左侧）提供一个编辑按钮。

- 它不修改 DSH 默认 `deployment:persona`，保留官方默认 agent prompt。
- 默认文本：`You are a helpful software engineer assistant.`
- 新会话创建时，聊天里会先出现一条 assistant 消息，内容为该提示词，之后才是用户输入。

## UI 入口

桌面端/Web 端打开任意会话后，在输入框右侧、模型选择左边会看到一个 **System Prompt** 按钮：

- 点击后弹出编辑框；
- 可以查看当前注入内容；
- 修改后保存，对之后新建的会话生效；
- 内容持久化到 `~/.dsh/dsh-session-prompt.json`。

## 自定义提示词

### 方式一：输入框 UI（推荐）

点击输入框左下角的 **System Prompt** 按钮，直接编辑并保存。

### 方式二：运行时工具

对 DSH 说：

```text
把 system prompt 设置为：You are a helpful software engineer assistant.
```

插件会调用 `dsh_session_prompt_set`，更新当前运行中的 system prompt，并持久化到：

```text
~/.dsh/dsh-session-prompt.json
```

### 方式三：通过插件配置

修改 DSH profile 的 `cordis.patch.yml`（例如 `~/.dsh/profiles/web/cordis.patch.yml`），加入或覆盖：

```yaml
- insert:
    - id: dsh-session-prompt
      name: '@dsh-external/dsh-session-prompt'
      config:
        prompt: 'You are a helpful software engineer assistant.'
```

如果你通过 bundle 方式装配，也可以直接修改本插件的 `cordis.patch.yml`。

> 提示：`prompt` 是纯静态文本，保持固定可以最大化前缀缓存命中。修改后需要重启 DSH 或热重载插件。

## 安装

### 运行时注入（开发态）

本插件已按注入器规范编写，资源全部挂 `ctx.effect`，可直接：

```bash
dev_inject_plugin D:/DeepSeek harness Test/dsh-session-prompt
```

### 官方装配（重启持久）

```bash
dsh plugin --profile web add D:/DeepSeek harness Test/dsh-session-prompt
# 或使用生成的 tgz
dsh plugin --profile web add D:/DeepSeek harness Test/dsh-session-prompt/dsh-external-dsh-session-prompt-0.1.0.tgz
```

## 构建

```bash
# 设置 DSH 源码 checkout 后执行
DSH_CHECKOUT="D:/deepseek harness" bash scripts/build.sh
# 构建客户端 UI
npm run build:client
```

或在已装配 dsh-super-injector 的环境中直接说：

```text
dev_build_plugin D:/DeepSeek harness Test/dsh-session-prompt
```

## 验证

新开会话后，模型实际收到的 system prompt 开头会类似：

```text
You are an AI agent powered by DeepSeek Harness.

...

You are a helpful software engineer assistant.

...
```

输入框左下角应出现 **System Prompt** 按钮。
