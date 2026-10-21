import { Collapsible } from "@ark-ui/solid/collapsible";
import type { JSX } from "solid-js";

/** A quiet line that opens and closes a body over Ark's Collapsible; the body is not rendered while closed. */
export const Disclosure = (props: { class?: string; label: string; children: JSX.Element }): JSX.Element => (
  <Collapsible.Root class={props.class} lazyMount unmountOnExit>
    <Collapsible.Trigger data-button="quiet" class="word">{props.label}</Collapsible.Trigger>
    <Collapsible.Content>{props.children}</Collapsible.Content>
  </Collapsible.Root>
);
