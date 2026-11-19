import { For } from "solid-js";
import type { JSX } from "@solidjs/web";
import { missingCoreParts } from "../app/failureOf";

/** HM7589a: the install command shows apart in mono, selectable, wrapping after each slash so the whole of it shows at any width. */
export const missingCoreContent = (message: string | null): JSX.Element | undefined => {
  const parts = message === null ? null : missingCoreParts(message);

  if (parts === null) return undefined;

  return <>{parts.lead}<code class="ink-command"><For each={parts.command.split(/(?<=\/)/)}>{piece => <>{piece}<wbr /></>}</For></code></>;
};
