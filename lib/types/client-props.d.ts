/** Runtime contract for every strict session-scoped DSH slot component. */
export interface SessionSlotProps {
    sessionId: string;
}
/** Kept outside React so the slot prop contract has a cheap regression test. */
export declare function sessionIdFromProps(props: SessionSlotProps): string;
