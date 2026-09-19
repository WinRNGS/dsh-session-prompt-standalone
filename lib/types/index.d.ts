/** DSH persistent prompt layers: global + workspace, system + user context. */
import { Context } from 'cordis';
export declare const name = "dsh-session-prompt";
export declare const inject: string[];
export interface Config {
    prompt?: string;
}
export declare function apply(ctx: Context, config?: Config): void;
