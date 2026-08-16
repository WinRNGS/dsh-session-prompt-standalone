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
import { Context } from 'cordis';
export declare const name = "dsh-session-prompt";
export declare const inject: string[];
export interface Config {
    /** 装配时提供的初始提示词；运行时会优先使用已保存的设置文件。 */
    prompt?: string;
}
export declare function apply(ctx: Context, config?: Config): void;
