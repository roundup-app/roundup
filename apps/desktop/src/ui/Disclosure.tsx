import { Collapsible } from "./Collapsible";
import { Icon } from "../ink/Icon";
import "./Disclosure.css";
import type { JSX } from "@solidjs/web";

/** A quiet line that opens and closes a body over ui-sdk's Collapsible; the body is not rendered while closed, and it starts closed unless `defaultOpen`. */
export const Disclosure = (props: { class?: string; label: string; defaultOpen?: boolean; children: JSX.Element }): JSX.Element => (
  <Collapsible.Root class={props.class} defaultOpen={props.defaultOpen}>
    <Collapsible.Trigger data-button="quiet" class="word disclosure-trigger"><Icon name="right" />{props.label}</Collapsible.Trigger>
    <Collapsible.Content>{props.children}</Collapsible.Content>
  </Collapsible.Root>
);
