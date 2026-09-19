/** Runtime contract for every strict session-scoped DSH slot component. */
export interface SessionSlotProps {
  sessionId: string
}

/** Kept outside React so the slot prop contract has a cheap regression test. */
export function sessionIdFromProps(props: SessionSlotProps): string {
  if (props === null || typeof props !== 'object' || props.sessionId === undefined || props.sessionId === null) {
    throw new TypeError('DSH session slot did not provide the top-level sessionId prop')
  }
  return String(props.sessionId)
}
