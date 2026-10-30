import "./Field.css";
import { Field } from "./Field";
import { createRowCollection } from "./RowCollection";
import { focusActions } from "./focusActions";
import * as combobox from "@zag-js/combobox";
import { normalizeProps, useMachine } from "@zag-js/solid";
import { useLocaleContext } from "@ark-ui/solid/locale";
import { useEnvironmentContext } from "@ark-ui/solid/environment";
import { useFieldContext } from "@ark-ui/solid/field";
import { captureFocus } from "../keys/focus";
import "./Combobox.css";
import "./Select.css";
import { Portal } from "solid-js/web";
import { Popover } from "./Popover";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import { copy } from "./copy";
import { Combobox as ArkCombobox, createListCollection } from "@ark-ui/solid/combobox";
import { createMemo, createSignal, createUniqueId, For, onCleanup, type JSX } from "solid-js";

type ComboboxItem = { value: string; label: string };

/** An always-open, filter-as-you-type list. The caller filters `items` and controls the field; Ark owns the highlight and `↑` `↓`; form choices wrap, and the pointer preserves the keyboard position. `onSelect` hears the highlighted value on `⏎`. */
const Root = (props: {
  items: readonly ComboboxItem[];
  /** Opt in only owned content rows; commands and form choices keep single activation. */
  contentRow?: (item: ComboboxItem) => boolean;
  highlightedValue: string | null;
  onHighlightChange: (value: string | null) => void;
  inputValue: string;
  /** Native selection/caret access; changing the query goes through `inputValue`. Focus only on explicit opening. */
  inputRef?: (input: HTMLInputElement) => void;
  initialFocus?: ReturnType<typeof captureFocus>;
  /** An enclosing Dialog owns focus when false. */
  autoFocus?: boolean;
  onDismiss?: () => void;
  focusScope?: () => HTMLElement | undefined;
  onInput: (text: string) => void;
  onSelect: (value: string) => void;
  label: string;
  placeholder: string;
  empty: string;
  group?: (item: ComboboxItem) => string | undefined;
  row: (item: ComboboxItem) => JSX.Element;
}) => {
  const dismiss = props.onDismiss ?? Popover.dismiss();
  const contains = (target: EventTarget | null, input: HTMLElement) => target instanceof Node && (props.focusScope?.() ?? input.closest(".app-combobox"))?.contains(target) === true;
  const collection = createMemo(() => createListCollection({ items: [...props.items], itemToValue: (item) => item.value, itemToString: (item) => item.label, groupBy: (item) => props.group?.(item) ?? "" }));

  const groups = createMemo(() => collection().group());

  // Typing and arrows own the highlight; a resting pointer must not move the selection wash.
  let pointerEvent = false;

  const notePointer = (): void => {
    pointerEvent = true;
    setTimeout(() => { pointerEvent = false; });
  };

  const initialFocus = props.initialFocus ?? Popover.initialFocus() ?? captureFocus();
  let input: HTMLInputElement | undefined;
  const id = createUniqueId();
  const locale = useLocaleContext();
  const environment = useEnvironmentContext();
  const field = useFieldContext();

  // Zag 1.45's open entry schedules focus regardless of autoFocus. Ark's useCombobox fixes
  // that machine, so retain it through RootProvider and guard only its focus actions.
  // https://github.com/chakra-ui/zag/blob/%40zag-js/combobox%401.45.0/packages/machines/combobox/src/combobox.machine.ts
  const machine = focusActions(combobox.machine, {
    setInitialFocus: () => {
      if (props.autoFocus === false) return;
      requestAnimationFrame(() => initialFocus(() => { if (input?.isConnected) input.focus({ preventScroll: true }); }));
    },
    setFinalFocus: () => {
      if (props.autoFocus === false) return;
      const focus = captureFocus();
      requestAnimationFrame(() => focus(() => { if (input?.isConnected) input.focus({ preventScroll: true }); }));
    },
  });

  const service = useMachine(machine, () => ({
    id, ids: { label: field?.().ids.label, input: field?.().ids.control },
    disabled: field?.().disabled, readOnly: field?.().readOnly, required: field?.().required, invalid: field?.().invalid,
    dir: locale().dir, getRootNode: environment().getRootNode,
    collection: collection(), multiple: props.items.some(item => props.contentRow?.(item)), open: true, inputBehavior: "none" as const, selectionBehavior: "clear" as const, loopFocus: !props.contentRow, autoFocus: false,
    onFocusOutside: event => { if (!(event.detail.target instanceof Node && props.focusScope?.()?.contains(event.detail.target))) dismiss?.(); },
    inputValue: props.inputValue, value: [], highlightedValue: props.contentRow ? props.highlightedValue ?? undefined : props.items.find(item => item.value === props.highlightedValue)?.value ?? props.items[0]?.value,
    onHighlightChange: details => { if (!pointerEvent) props.onHighlightChange(details.highlightedValue); },
    onInputValueChange: details => props.onInput(details.inputValue),
    onOpenChange: details => { if (!details.open && details.reason === "escape-key") dismiss?.(); },
    onValueChange: details => { const [value] = details.value;

      if (value !== undefined) props.onSelect(value); },
  }));

  const api = createMemo(() => combobox.connect(service, normalizeProps));

  // Keep content selection independent of Zag's always-empty activation value and native query.
  const rows = new Map<string, HTMLDivElement>();

  const content = createRowCollection(() => props.items.filter(item => {
    const row = rows.get(item.value);

    return props.contentRow?.(item) && row && !row.closest("[hidden], [inert], [aria-disabled=true]");
  }), { onFocus: value => props.onHighlightChange(value), onActivate: value => props.onSelect(value) });

  // The Tab stop is available before item refs mount; gesture eligibility uses the mounted collection.
  const tabStop = () => props.items.find(item => props.contentRow?.(item) && item.value === props.highlightedValue)?.value
    ?? props.items.find(item => props.contentRow?.(item))?.value;

  const itemRow = (item: ComboboxItem) => <ArkCombobox.Item item={item} asChild={itemProps => <div {...itemProps({})} class="app-combobox-item"
    ref={element => {
      if (!props.contentRow?.(item)) return;
      rows.set(item.value, element);
      content.register(element, item.value);
      onCleanup(() => rows.delete(item.value));
    }} tabIndex={props.contentRow?.(item) && tabStop() === item.value ? 0 : -1}
    onFocus={() => { if (props.contentRow?.(item)) props.onHighlightChange(item.value); }} aria-selected={props.contentRow?.(item) ? content.selection.isSelected(item.value) : undefined}
    data-row-selected={props.contentRow?.(item) && content.selection.isSelected(item.value) ? "true" : undefined}>
    {props.row(item)}
  </div>} />;


  return <ArkCombobox.RootProvider value={api} class="app-combobox" lazyMount={false}>
    <ArkCombobox.Label class="app-combobox-label">{props.label}</ArkCombobox.Label>
    <ArkCombobox.Control><ArkCombobox.Input spellcheck={false} autocorrect="off" autocapitalize="off" on:keydown={{ capture: true, handleEvent: (event: KeyboardEvent) => {
      // Home/End edit the query; content-row navigation starts only after focus leaves it.
      if (props.contentRow && (event.key === "Home" || event.key === "End")) event.stopPropagation();

      if (!props.contentRow && event.key === "Tab" && !event.shiftKey && !event.isComposing && api().highlightedValue) {
        event.preventDefault();
        api().selectValue(api().highlightedValue!);
      }
    } }} ref={element => {
      const focus = initialFocus;
      input = element;
      const signal = focus.signal(target => contains(target, element));
      const cancel = () => dismiss?.();
      signal.addEventListener("abort", cancel, { once: true });
      onCleanup(() => signal.removeEventListener("abort", cancel));

      if (signal.aborted) queueMicrotask(() => { if (element.isConnected) cancel(); });
      props.inputRef?.(element);
    }} class="app-combobox-input" placeholder={props.placeholder} /></ArkCombobox.Control>
    <ArkCombobox.Content class="app-combobox-list" on:click={{ handleEvent: content.click, capture: true }} on:pointermove={{ handleEvent: notePointer, capture: true }} on:pointerleave={{ handleEvent: notePointer, capture: true }}>
      <For each={groups().map(([group]) => group)} fallback={<p class="app-combobox-empty">{props.empty}</p>}>
        {(group) => {
          // Key the owner by its group name: replacing a tuple remounts every option on each edit (Z3788d).
          const items = () => groups().find(([name]) => name === group)?.[1] ?? [];

          return group ? <ArkCombobox.ItemGroup>
            <ArkCombobox.ItemGroupLabel class="app-combobox-group-label">{group}</ArkCombobox.ItemGroupLabel>
            <For each={items()}>{(item) => itemRow(item)}</For>
          </ArkCombobox.ItemGroup> : <For each={items()}>{(item) => itemRow(item)}</For>;
        }}
      </For>
    </ArkCombobox.Content>
  </ArkCombobox.RootProvider>;
};


/** A filtered choice anchored to its trigger. Ark owns opening, dismissal and focus return. */
const Picker = (props: { label: string; value: string; savedLabel?: string; items: readonly ComboboxItem[]; onSelect: (value: string) => void }) => {
  const field = useFieldContext();
  const caption = createUniqueId();
  const valueId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  let content: HTMLDivElement | undefined;
  const items = () => props.items.filter(item => item.label.toLocaleLowerCase().includes(query().toLocaleLowerCase()));

  return <div class="app-select"><span id={caption} class="app-combobox-label">{props.label}</span><Popover.Root open={open()} onOpenChange={({ open }) => { setOpen(open); setQuery(""); setHighlight(null); }} autoFocus={false} closeOnEscape closeOnInteractOutside initialFocusEl={() => input ?? null} positioning={{ placement: "bottom-start", strategy: "fixed", sameWidth: true }}>
    <Popover.Trigger id={field?.().ids.control} disabled={field?.().disabled} aria-invalid={field?.().invalid ? "true" : undefined} aria-describedby={field?.().ariaDescribedby} data-invalid={field?.().invalid ? "" : undefined} class="app-select-trigger" aria-labelledby={`${caption} ${valueId}`}>
      <span id={valueId}>{props.items.find(item => item.value === props.value)?.label ?? props.savedLabel ?? props.label}</span>
      <ChevronDown aria-hidden="true" class="app-select-mark" size={16} />
    </Popover.Trigger>
    <Portal><Popover.Positioner><Popover.Content ref={element => { content = element; }} class="choice-picker" aria-label={props.label} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}>
      {/* A separate Field keeps the query label from naming the trigger with the same control ID. */}
      <Field.Root><Root focusScope={() => content} onDismiss={() => setOpen(false)} items={items()} highlightedValue={highlight()} onHighlightChange={setHighlight} inputValue={query()} inputRef={element => { input = element; }} onInput={setQuery}
        onSelect={value => { props.onSelect(value); setOpen(false); }} label={props.label} placeholder={props.label} empty={copy.noMatch} row={item => <>{item.label}{item.value === props.value && <Check class="app-choice-check" aria-hidden="true" size={16} />}</>} /></Field.Root>
    </Popover.Content></Popover.Positioner></Portal>
  </Popover.Root></div>;
};

export const Combobox = { Root, Picker };
