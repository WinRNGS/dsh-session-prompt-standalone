/**
 * @dsh-external/dsh-session-prompt — system prompt 固定段注入器（单通道）。
 *
 * 设计（v0.2.0 起固化）：
 * 1. 只注册一段静态 system prompt section（`session-prompt:persistent`，order 10，
 *    紧跟官方 deployment:persona 之后），每次请求重新组装 → 上下文压缩后依然有效，
 *    且不覆盖官方 persona。
 * 2. 不再向会话注入 user 消息（旧的"可见层"已删除），原因：
 *    ① 同一文本会被投递两遍（system 段 + 历史 user 消息），token 翻倍；
 *    ② 改词后旧会话里残留的旧文本快照会与当前段互相矛盾；
 *    ③ 该层依赖 `session.events`，DSH 0.1.5-rc.1 已移除该 getter
 *       （改为 snapshotEvents()/ownEvents()/eventAt()），异常又被自身 catch
 *       吞掉 → 静默失灵（2026-09-09 之后所有新会话均无注入）。
 *    用户可见性由输入栏 System Prompt 按钮与 `dsh_session_prompt_set` 工具保证。
 *
 * 依赖：`webServer` 走内层 `ctx.inject`，非 web profile（headless/CLI）下
 * 仍能装配段与管理工具，只是没有 UI/API。
 *
 * 配置：~/.dsh/dsh-session-prompt.json（UI / dsh_session_prompt_set 写入）。
 * 默认值：内置一份通用「AI 工程 Agent 工作守则」，可用 cordis.patch.yml 的
 *         config.prompt 覆盖，或在 UI/工具里改成自己的版本。
 */
import { Context } from 'cordis';
export declare const name = "dsh-session-prompt";
export declare const inject: string[];
export interface Config {
    /** 装配时提供的初始提示词；运行时会优先使用已保存的设置文件。 */
    prompt?: string;
}
export declare function apply(ctx: Context, config?: Config): void;
