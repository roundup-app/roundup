import { Accordion as ArkAccordion } from "@ark-ui/solid/accordion";
import { For, Show, type JSX } from "solid-js";
import { Icon } from "../ink/Icon";

/** One collapsible section at a time; Ark owns focus and keyboard activation. */
export const Accordion = (props: {
  value: string[];
  onChange: (value: string[]) => void;
  items: { id: string; label: string; unseen: boolean; actions?: JSX.Element; content: () => JSX.Element }[];
}) => <ArkAccordion.Root class="overview-sections" collapsible multiple={false} lazyMount
  value={props.value} onValueChange={details => props.onChange(details.value)}>
  <For each={props.items.map(item => item.id)}>{(id, index) => {
    const item = () => props.items.find(item => item.id === id)!;
    const content = item().content;

    return <ArkAccordion.Item value={id}>
    <div class="overview-section-heading">
      <h2><ArkAccordion.ItemTrigger data-button="quiet" class="overview-section-trigger" data-unseen={item().unseen} onKeyDown={event => {
          // Zag 1.45 wraps with no loop option; keep the scenario's end headings stationary.
          if (event.key === "ArrowUp" && index() === 0 || event.key === "ArrowDown" && index() === props.items.length - 1) event.preventDefault();
        }}>
        <ArkAccordion.ItemIndicator><Icon name="right" /></ArkAccordion.ItemIndicator>
        {item().label}<Show when={item().unseen}><span class="overview-unseen" aria-hidden="true" /></Show>
      </ArkAccordion.ItemTrigger></h2>
      {item().actions}
    </div>
    <ArkAccordion.ItemContent role="group">{content()}</ArkAccordion.ItemContent>
  </ArkAccordion.Item>; }}</For>
</ArkAccordion.Root>;
