import { fireEvent } from "@solidjs/testing-library";
import { armLeader, leaderArmed } from "./registry";

/** `⌘K` then `code`, as the leader takes it (U2239). A fixture that mounts no `Leader` has nothing bound to `⌘K`, so the wait is armed directly. Returns whether the key was left unhandled, as `fireEvent` does. */
export const leaderKey = (code: string, init: KeyboardEventInit = {}, target: Document | Element = document): boolean => {
  const arm = new KeyboardEvent("keydown", { code: "KeyK", key: "k", metaKey: true, bubbles: true, cancelable: true });

  document.body.dispatchEvent(arm);

  if (!leaderArmed()) armLeader(arm);

  return fireEvent.keyDown(target, { code, key: code.replace(/^Key/, "").toLowerCase(), ...init });
};
