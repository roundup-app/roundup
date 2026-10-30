import { Combobox, createListCollection, useComboboxContext } from "@ark-ui/solid/combobox";
import { createContext, createMemo, createSignal, useContext, For, Show, splitProps, type JSX } from "solid-js";
import { mergeProps } from "@zag-js/solid";
import { Portal } from "solid-js/web";
import "./Combobox.css";
import { floatingControl } from "./Dialog";

const PointerHighlight = createContext<() => void>(() => undefined);

type Mention = { value: string; label: string };

/** A textarea suggestion list: Ark owns keyboard navigation, activation and the input's active descendant. */
const Root = (props: {
  items: readonly Mention[];
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  onSelect: (value: string) => void;
  inputValue: string;
  children: JSX.Element;
  onDismiss: () => void;
}) => {
  const collection = createMemo(() => createListCollection({ items: [...props.items], itemToValue: item => item.value, itemToString: item => item.label }));

  // Zag 1.45 reports pointer and keyboard highlights through the same callback.
  // Keep the controlled keyboard choice while allowing item clicks and tooltip events.
  let pointerEvent = false;
  const notePointer = () => {
    pointerEvent = true;
    setTimeout(() => { pointerEvent = false; });
  };

  const [element, setElement] = createSignal<HTMLElement>();
  const control = floatingControl({ get open() { return props.items.length > 0; }, onOpenChange: details => { if (!details.open) props.onDismiss(); } }, element);

  return <PointerHighlight.Provider value={notePointer}><Combobox.Root ref={setElement} collection={collection()} open={control.open()} inputValue={props.inputValue}
    value={[]} highlightedValue={props.highlightedValue} loopFocus inputBehavior="none" selectionBehavior="preserve"
    openOnClick={false} openOnKeyPress={false} positioning={{ placement: "bottom-start", gutter: 4, strategy: "fixed" }}
    onHighlightChange={details => { if (!pointerEvent) props.onHighlightChange(details.highlightedValue); }}
    onOpenChange={control.change}
    onValueChange={details => { const value = details.value[0];

      if (value !== undefined) props.onSelect(value); }}>
    {props.children}
  </Combobox.Root></PointerHighlight.Provider>;
};

const Field = (props: Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "onKeyDown"> & { open: boolean; onKey: (event: KeyboardEvent) => void }) => {
  const [local, rest] = splitProps(props, ["open", "onKey"]);
  const combobox = useComboboxContext();

  const onKeyDown = (event: KeyboardEvent) => {
    if (local.open && !event.isComposing && !event.shiftKey && event.key === "Tab" && combobox().highlightedValue) {
      event.preventDefault();
      combobox().selectValue(combobox().highlightedValue!);

      return;
    }

    // Ark handles the open list; the Ask bar handles submission and the second Escape.
    if (!local.open || event.key === "Escape") local.onKey(event);
  };

  return <Combobox.Control><Combobox.Input asChild={attributes => {
    const inputAttributes: () => JSX.InputHTMLAttributes<HTMLTextAreaElement> = attributes;
    const [, input] = splitProps(mergeProps(inputAttributes, { onKeyDown }), ["type", "role", "aria-expanded", "aria-controls"]);

    // Ark's input defaults to a single-line combobox; mentions keep the textarea's
    // multiline textbox role, which supports active-descendant list navigation.
    return <textarea {...input} {...rest} role="textbox" aria-multiline="true" aria-haspopup="listbox" aria-controls={local.open ? combobox().getInputProps()["aria-controls"] : undefined} spellcheck={false} autocorrect="off" autocapitalize="off" />;
  }} /></Combobox.Control>;
};

const List = (props: { label: string; items: readonly Mention[]; row: (item: Mention) => JSX.Element }) => (
  <Show when={props.items.length > 0}><Portal><Combobox.Positioner><Combobox.Content class="app-popover app-mentions-panel app-mentions app-combobox-list" aria-label={props.label} on:pointermove={{ capture: true, handleEvent: useContext(PointerHighlight) }} on:pointerleave={{ capture: true, handleEvent: useContext(PointerHighlight) }}>
    <For each={props.items}>{item => <Combobox.Item item={item} class="app-combobox-item"><Combobox.ItemText>{props.row(item)}</Combobox.ItemText></Combobox.Item>}</For>
  </Combobox.Content></Combobox.Positioner></Portal></Show>
);

export const Mentions = { Root, Field, List };
