# @dsh-external/dsh-session-prompt

DSH 插件：在每个新会话中自动注入你的自定义指令。

- **持久层**：以静态 system prompt 段存在，上下文压缩后依然有效，且不覆盖官方默认 persona。
- **可见层**：新会话聊天里会出现一条 `dsh-session-prompt` 来源的上下文消息，用户能直接看到。
- **输入框 UI**：在模型选择左侧提供 **System Prompt** 按钮，可随时查看/修改注入内容。

## 克隆

```bash
git clone https://github.com/WinRNGS/dsh-session-prompt-standalone.git
cd dsh-session-prompt-standalone
```

## 安装

### 运行时注入（开发态）

在已装配 `dsh-super-injector` 的 DSH 环境中，对本仓库目录执行：

```text
dev_inject_plugin <本仓库的绝对路径>
```

例如克隆到 `C:/Users/You/dsh-session-prompt-standalone`：

```text
dev_inject_plugin C:/Users/You/dsh-session-prompt-standalone
```

### 官方装配（重启持久）

```bash
# 使用仓库目录
dsh plugin --profile web add <本仓库的绝对路径>

# 或使用仓库内的 tgz
dsh plugin --profile web add <本仓库的绝对路径>/dsh-external-dsh-session-prompt-0.1.0.tgz
```

## 构建

需要先有 DSH 源码 checkout：

```bash
# 把 <DSH_CHECKOUT> 换成你自己的 DSH 源码目录
DSH_CHECKOUT=<DSH_CHECKOUT> bash scripts/build.sh

# 构建客户端 UI
npm run build:client
```

在已装配 dsh-super-injector 的环境中，也可以直接说：

```text
dev_build_plugin <本仓库的绝对路径>
```

## 自定义指令

- 点击输入框左侧 **System Prompt** 按钮直接编辑；
- 或对 DSH 说：`把 system prompt 设置为：...`；
- 内容持久化到 `~/.dsh/dsh-session-prompt.json`。

## 验证

新会话中：

1. 聊天里会出现一条 `dsh-session-prompt` 来源的上下文消息；
2. system prompt 中包含 `session-prompt:persistent` 段；
3. 官方默认 `deployment:persona` 保持不变。
