/** Single-assistant dispatch is legacy. Squad (Triage→Negotiator→Closing) is canonical. */
export function isSingleAssistantDispatchAllowed() {
  return process.env.ALLOW_SINGLE_ASSISTANT_DISPATCH === "true";
}
