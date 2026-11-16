import "./Field.css";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Command, CommandEmpty, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList } from "@ui-sdk/solid/command";
import { useFieldControl } from "@ui-sdk/solid/field";
import { Field } from "./Field";
import { createRowCollection } from "./RowCollection";
import { captureFocus } from "../keys/focus";
import "./Combobox.css";
import "./Select.css";
import { createMemo, createSignal, createUniqueId, For, onCleanup, onSettled, untrack } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Popover } from "./Popover";
import Check from "@lucide/solid/icons/check";
import ChevronDown from "@lucide/solid/icons/chevron-down";
import { copy } from "./copy";

type ComboboxItem = { value: string; label: string };

/** An always-open, filter-as-you-type list. The caller filters `items` and controls the field; ui-sdk's Command owns the highlight and `↑` `↓`; form choices wrap, `Home` `End` jump to the first and last, a pick returns focus to the field, and the pointer preserves the keyboard position. `onSelect` hears the highlighted value on `⏎`. */
const Root = (props: {
  items: readonly ComboboxItem[];
  /** Opt in only owned content rows; commands and form choices keep single activation. */
  contentRow?: (item: ComboboxItem) => boolean;
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  inputValue: string;
  /** Native selection/caret access; changing the query goes through `inputValue`. Focus only on explicit opening. */
  inputRef?: (input: HTMLInputElement) => void;
  /** Native listeners on the input, removed with the Combobox; `onInput` and `onSelect` here stay the query and choice callbacks. */
  inputEvents?: { input?: (event: Event) => void; select?: (event: Event) => void; focus?: (event: FocusEvent) => void; keydown?: (event: KeyboardEvent) => void; keyup?: (event: KeyboardEvent) => void; pointerup?: (event: PointerEvent) => void; blur?: (event: FocusEvent) => void };
  initialFocus?: ReturnType<typeof captureFocus>;
  /** An enclosing Dialog owns focus when false. */
  autoFocus?: boolean;
  onDismiss?: () => void;
  focusScope?: () => HTMLElement | undefined;
  onInput: (text: string) => void;
  onSelect: (value: string) => void;
  label: string;
  placeholder: string;
  empty: JSX.Element;
  group?: (item: ComboboxItem) => string | undefined;
  row: (item: ComboboxItem) => JSX.Element;
}) => {
  const dismiss = props.onDismiss ?? Popover.dismiss();
  const contains = (target: EventTarget | null, input: HTMLElement) => target instanceof Node && untrack(() => props.focusScope?.() ?? input.closest(".app-combobox"))?.contains(target) === true;

  const groups = createMemo(() => {
    const groupOf = props.group;

    return [...Map.groupBy(props.items, item => groupOf?.(item) ?? "")];
  });

  const initialFocus = props.initialFocus ?? Popover.initialFocus() ?? captureFocus();
  let input: HTMLInputElement | undefined;

  // Content rows start without a highlight; form choices always hold one.
  const highlighted = () => props.contentRow ? props.highlightedValue : (props.items.find(item => item.value === props.highlightedValue) ?? props.items[0])?.value ?? null;

  // A pick returns focus to the field, unless a newer focus choice comes first; content rows keep the focus they took.
  const pick = (value: string) => {
    const focus = captureFocus();

    props.onSelect(value);

    if (props.autoFocus === false || props.contentRow) return;
    // A closed popup keeps its field mounted, hidden: only a live field takes the focus back.
    requestAnimationFrame(() => focus(() => { if (input?.isConnected && !input.closest("[hidden], [inert]")) input.focus({ preventScroll: true }); }));
  };

  onSettled(() => {
    const element = input;

    if (!element) return;
    const signal = initialFocus.signal(target => contains(target, element));
    const cancel = () => dismiss?.();
    // listener-owner: onSettled refuses onCleanup, so the cleanup it returns removes this.
    signal.addEventListener("abort", cancel, { once: true });

    if (signal.aborted) queueMicrotask(() => { if (element.isConnected) cancel(); });
    const frame = props.autoFocus === false ? undefined : requestAnimationFrame(() => initialFocus(() => { if (element.isConnected) element.focus({ preventScroll: true }); }));

    return () => {
      signal.removeEventListener("abort", cancel);

      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });

  makeEventListener(document, "focusin", event => { if (input && !contains(event.target, input)) dismiss?.(); });

  // Keep content selection independent of the highlight and the native query.
  const rows = new Map<string, HTMLDivElement>();

  const content = createRowCollection(() => props.items.filter(item => {
    const row = rows.get(item.value);

    return props.contentRow?.(item) && row && !row.closest("[hidden], [inert], [aria-disabled=true]");
  }), { onFocus: value => props.onHighlightChange(value), onActivate: value => props.onSelect(value) });

  // The Tab stop is available before item refs mount; gesture eligibility uses the mounted collection.
  const tabStop = () => props.items.find(item => props.contentRow?.(item) && item.value === props.highlightedValue)?.value
    ?? props.items.find(item => props.contentRow?.(item))?.value;

  const itemRow = (item: ComboboxItem) => {
    let row: HTMLDivElement | undefined;
    onCleanup(() => { if (row && rows.get(item.value) === row) rows.delete(item.value); });

    return <CommandItem value={item.value} data-value={item.value} label={item.label} class="app-combobox-item"
      ref={element => {
        if (!props.contentRow?.(item)) return;
        row = element;
        rows.set(item.value, element);
        content.register(element, item.value);
      }} tabindex={props.contentRow?.(item) && tabStop() === item.value ? 0 : -1}
      onFocus={() => { if (props.contentRow?.(item)) props.onHighlightChange(item.value); }}
      data-row-selected={props.contentRow?.(item) && content.selection.isSelected(item.value) ? "true" : undefined}
      render={attributes => <div {...attributes} aria-selected={props.contentRow?.(item) ? String(content.selection.isSelected(item.value)) : attributes["aria-selected"]} />}>
      {props.row(item)}
    </CommandItem>;
  };

  return <Command class="app-combobox" value={highlighted()} loop={!props.contentRow} filter={false} query={props.inputValue} onAction={pick}
    onValueChange={(value, details) => { if (details.reason === "item-hover") details.cancel(); else props.onHighlightChange(value); }}
    onQueryChange={(query, details) => { if (details.reason === "escape-key") details.cancel(); else props.onInput(query); }}>
    <CommandInput class="app-combobox-input" aria-label={props.label} placeholder={props.placeholder} spellcheck={false} autocorrect="off" autocapitalize="off"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          dismiss?.();

          return;
        }

        // Home/End edit the query for content rows, whose navigation starts only after focus leaves it; form choices move the highlight.
        if (props.contentRow && (event.key === "Home" || event.key === "End")) event.stopPropagation();

        if (!props.contentRow && (event.key === "Home" || event.key === "End") && !event.ctrlKey && !event.isComposing) {
          const ordered = groups().flatMap(([, items]) => items);
          const edge = event.key === "Home" ? ordered[0] : ordered.at(-1);

          event.preventDefault();

          if (edge) props.onHighlightChange(edge.value);

          return;
        }

        const value = highlighted();

        if (!props.contentRow && event.key === "Tab" && !event.shiftKey && !event.isComposing && value !== null) {
          event.preventDefault();
          pick(value);
        }
      }} ref={element => {
        input = element;
        makeEventListener(element, "input", event => props.inputEvents?.input?.(event));
        makeEventListener(element, "select", event => props.inputEvents?.select?.(event));
        makeEventListener(element, "focus", event => props.inputEvents?.focus?.(event));
        makeEventListener(element, "keydown", event => props.inputEvents?.keydown?.(event));
        makeEventListener(element, "keyup", event => props.inputEvents?.keyup?.(event));
        makeEventListener(element, "pointerup", event => props.inputEvents?.pointerup?.(event));
        makeEventListener(element, "blur", event => props.inputEvents?.blur?.(event));
        props.inputRef?.(element);
      }} />
    <CommandEmpty class="app-combobox-empty">{props.empty}</CommandEmpty>
    <CommandList class="app-combobox-list" aria-multiselectable={props.items.some(item => props.contentRow?.(item)) ? "true" : undefined} ref={element => { makeEventListener(element, "click", content.click, { capture: true }); }}>
      <For each={groups().map(([group]) => group)}>
        {(group) => {
          // Key the owner by its group name: replacing a tuple remounts every option on each edit (Z3788d).
          const items = () => groups().find(([name]) => name === group)?.[1] ?? [];

          return group ? <CommandGroup>
            <CommandGroupLabel class="app-combobox-group-label">{group}</CommandGroupLabel>
            <For each={items()}>{(item) => itemRow(item)}</For>
          </CommandGroup> : <For each={items()}>{(item) => itemRow(item)}</For>;
        }}
      </For>
    </CommandList>
  </Command>;
};

/** A filtered choice anchored to its trigger. ui-sdk's Popover owns opening, dismissal and focus return. */
const Picker = (props: { label: string; value: string; savedLabel?: string; items: readonly ComboboxItem[]; onSelect: (value: string) => void }) => {
  const field = useFieldControl();
  const control = field?.props({});
  const caption = createUniqueId();
  const valueId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  let content: HTMLDivElement | undefined;
  const items = () => props.items.filter(item => item.label.toLocaleLowerCase().includes(query().toLocaleLowerCase()));

  return <div class="app-select"><span id={caption} class="app-combobox-label">{props.label}</span><Popover.Root open={open()} onOpenChange={({ open }) => { setOpen(open); setQuery(""); setHighlight(null); }} initialFocusEl={() => input}>
    <Popover.Trigger {...control} disabled={field?.disabled() ?? false} class="app-select-trigger" aria-labelledby={`${caption} ${valueId}`}>
      <span id={valueId}>{props.items.find(item => item.value === props.value)?.label ?? props.savedLabel ?? props.label}</span>
      <ChevronDown aria-hidden="true" class="app-select-mark" size={16} />
    </Popover.Trigger>
    <Popover.Content ref={element => { content = element; }} class="choice-picker" aria-label={props.label} side="bottom" align="start">
      {/* A separate Field keeps the query input out of the trigger's field wiring. */}
      <Field.Root><Root focusScope={() => content} onDismiss={() => setOpen(false)} items={items()} highlightedValue={highlight()} onHighlightChange={setHighlight} inputValue={query()} inputRef={element => { input = element; }} onInput={setQuery}
        onSelect={value => { props.onSelect(value); setOpen(false); }} label={props.label} placeholder={props.label} empty={copy.noMatch} row={item => <>{item.label}{item.value === props.value && <Check class="app-choice-check" aria-hidden="true" size={16} />}</>} /></Field.Root>
    </Popover.Content>
  </Popover.Root></div>;
};

export const Combobox = { Root, Picker };
