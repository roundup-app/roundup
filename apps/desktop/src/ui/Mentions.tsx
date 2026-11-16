import { Command, CommandInput, CommandItem, CommandItemText, CommandList } from "@ui-sdk/solid/command";
import { Popover, PopoverContent } from "@ui-sdk/solid/popover";
import { createContext, createSignal, For, omit, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import "./Combobox.css";
import "./Popover.css";
import { createFloatingControl } from "./Dialog";

type Mention = { value: string; label: string };

const Suggestions = createContext<{ field: () => HTMLElement | undefined; setField: (element: HTMLElement) => void; highlighted: () => string | null; select: (value: string) => void }>();

/** A textarea suggestion list: ui-sdk's Command owns keyboard navigation, activation and the input's active descendant. */
const Root = (props: {
  items: readonly Mention[];
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  onSelect: (value: string) => void;
  inputValue: string;
  children: JSX.Element;
  onDismiss: () => void;
}) => {
  const [element, setElement] = createSignal<HTMLElement>();
  const [field, setField] = createSignal<HTMLElement>();
  const control = createFloatingControl({ get open() { return props.items.length > 0; }, onOpenChange: details => { if (!details.open) props.onDismiss(); } }, element);

  // A press or focus landing on the textarea itself is editing, not leaving the list.
  const withinField = (event: Event | undefined) => event?.target instanceof Node && field()?.contains(event.target) === true;

  // Pointer movement keeps the controlled keyboard choice; clicks still activate through onAction.
  return <Command ref={setElement} value={props.highlightedValue} query={props.inputValue} filter={false} loop onAction={props.onSelect}
    onValueChange={(value, details) => { if (details.reason === "item-hover") details.cancel(); else props.onHighlightChange(value); }}>
    <Popover open={control.open()} onOpenChange={(open, details) => { if (open || !(details.reason === "outside-press" || details.reason === "focus-out") || !withinField(details.event)) control.change({ open }); }}>
      <Suggestions value={{ field, setField, highlighted: () => props.highlightedValue, select: value => props.onSelect(value) }}>{props.children}</Suggestions>
    </Popover>
  </Command>;
};

const Field = (props: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "onKeyDown"> & { open: boolean; onKey: (event: KeyboardEvent) => void }) => {
  const mentions = useContext(Suggestions);
  const rest = omit(props, "open", "onKey", "class", "ref");

  // ui-sdk's input is single-line; mentions keep the textarea's multiline textbox role, which supports active-descendant list navigation.
  return <CommandInput render={attributes => {
    const input = omit(attributes, "type", "role", "aria-expanded", "aria-controls", "onKeyDown", "ref");

    return <textarea {...input} {...rest} ref={[attributes.ref, props.ref, mentions.setField]}
    class={`${props.class ?? ""} field-frame`} role="textbox" aria-multiline="true" aria-haspopup="listbox" aria-controls={props.open ? attributes["aria-controls"] : undefined} spellcheck={false} autocorrect="off" autocapitalize="off"
    onKeyDown={(event: KeyboardEvent) => {
      const value = mentions.highlighted();

      if (props.open && !event.isComposing && !event.shiftKey && event.key === "Tab" && value) {
        event.preventDefault();
        mentions.select(value);

        return;
      }

      // The list handles its keys; the Ask bar handles submission and the second Escape.
      if (!props.open || event.key === "Escape") props.onKey(event);
      else attributes.onKeyDown?.(event);
    }} />;
  }} />;
};

const List = (props: { label: string; items: readonly Mention[]; row: (item: Mention) => JSX.Element }) => {
  const mentions = useContext(Suggestions);

  return <Show when={props.items.length > 0 && mentions.field()}>{field =>
    <PopoverContent anchor={field()} initialFocus="none" finalFocus="none" side="bottom" align="start" sideOffset={4} class="app-popover app-mentions-panel"
      render={attributes => {
        const panel = omit(attributes, "role", "aria-labelledby", "aria-describedby");

        return <div {...panel} role="presentation" />;
      }}>
      <CommandList class="app-mentions app-combobox-list" aria-label={props.label} render={attributes => {
        const list = omit(attributes, "aria-labelledby");

        return <div {...list} />;
      }}>
        <For each={props.items}>{item => <CommandItem value={item.value} label={item.label} class="app-combobox-item"><CommandItemText>{props.row(item)}</CommandItemText></CommandItem>}</For>
      </CommandList>
    </PopoverContent>}
  </Show>;
};

export const Mentions = { Root, Field, List };
