import "./Listbox.css";
import { Listbox as ArkListbox, createListCollection, useListboxContext } from "@ark-ui/solid/listbox";
import { createMemo, createUniqueId, splitProps, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

type Answer = { value: string; label: string; description: string; disabled?: boolean };

const key = (value: string | null) => value === null ? "own" : `answer:${value}`;

const answerOf = (value: string | null) => value?.startsWith("answer:") ? value.slice(7) : null;

/** Controlled single-answer choice. Null is the own-answer stop, never a rendered supplied answer.
 * Set both controlled values from both callbacks for U406's selection-follows-highlight policy.
 * Opening and external updates never request keyboard focus. */
const Root = (props: {
  answers: Answer[];
  value: string | null;
  highlightedValue: string | null;
  onValueChange: (value: string | null) => void;
  onHighlightChange: (value: string | null) => void;
  /** Explicit false permits editing while pending; omitted preserves the pending lock. */
  disabled?: boolean;
  pending?: boolean;
  children: JSX.Element;
}) => {
  // Ark navigates this collection, including a virtual own-answer stop. Only caller answers render.
  const collection = createMemo(() => createListCollection({
    items: [...props.answers, { value: null, label: "" }],
    itemToValue: item => key(item.value),
    itemToString: item => item.label,
  }));

  return <ArkListbox.Root collection={collection()} value={[key(props.value)]} highlightedValue={key(props.highlightedValue)}
    onValueChange={details => props.onValueChange(answerOf(details.value[0] ?? null))}
    onHighlightChange={details => props.onHighlightChange(answerOf(details.highlightedValue))}
    disabled={props.disabled ?? props.pending} loopFocus selectOnHighlight typeahead={false} aria-busy={props.pending || undefined}>
    {props.children}
  </ArkListbox.Root>;
};

const Content = (props: ArkListbox.ContentProps) => {
  const listbox = useListboxContext();

  return <ArkListbox.Content {...props} class={`app-listbox ${props.class ?? ""}`}
    aria-activedescendant={answerOf(listbox().highlightedValue) === null ? "" : listbox().getContentProps()["aria-activedescendant"]}
    aria-disabled={listbox().disabled || undefined} />;
};

const Item = (props: { item: Answer; class?: string; children?: JSX.Element }) => {
  const id = createUniqueId();

  return <ArkListbox.Item item={props.item} class={`app-listbox-item ${props.class ?? ""}`} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`}>
    <ArkListbox.ItemText id={`${id}-label`}>{props.item.label}</ArkListbox.ItemText>
    {props.children}
    <span id={`${id}-description`} class="app-listbox-description">{props.item.description}</span>
  </ArkListbox.Item>;
};

/** Ark binds arrows to the associated list. Enter and text editing stay with the note's caller.
 * Disabled keeps focus on a read-only note. Callers own submission and draft recovery. */
const NoteField = <T extends HTMLInputElement | HTMLTextAreaElement>(props: JSX.InputHTMLAttributes<T>, element: "input" | "textarea") => {
  const listbox = useListboxContext();
  const [local, rest] = splitProps(props, ["onKeyDown"]);

  const binding = createMemo(() => {
    const native: unknown = listbox().getInputProps();

    // SAFETY: Ark uses only shared native value/caret and keyboard behavior here; the wrappers
    // pair T with its native tag, including the textarea Ark does not type directly.
    const { onKeyDown, ...input } = native as JSX.InputHTMLAttributes<T>;

    return { input, onKeyDown };
  });

  // SAFETY: Native tag and event target are paired by the two typed wrappers below.
  const Field = Dynamic as Component<JSX.InputHTMLAttributes<T> & { component: "input" | "textarea" }>;

  return <Field component={element} {...binding().input} {...rest} class={`app-listbox-note ${props.class ?? ""}`} disabled={props.disabled ?? false} readOnly={listbox().disabled || props.readOnly}
    aria-disabled={listbox().disabled || props["aria-disabled"]}
    aria-controls={listbox().collection.size > 1 ? binding().input["aria-controls"] : ""}
    aria-activedescendant={answerOf(listbox().highlightedValue) === null ? "" : binding().input["aria-activedescendant"]}
    onKeyDown={(event: KeyboardEvent & { currentTarget: T; target: Element }) => {
      if (listbox().disabled) {
        if (event.key === "Enter") event.preventDefault();

        return;
      }

      const handler = local.onKeyDown;

      if (handler) {
        if (0 in handler) handler[0](handler[1], event);
        else handler(event);
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const navigate = binding().onKeyDown;

        if (navigate) {
          if (0 in navigate) navigate[0](navigate[1], event);
          else navigate(event);
        }
      }
    }} />;
};

const NoteInput = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => NoteField(props, "input");

/** Native multiline value, caret, ref and events belong to the caller. Shift+Enter edits;
 * Enter reaches onKeyDown so the caller can explicitly submit and prevent its default. */
const NoteTextarea = (props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) => NoteField(props, "textarea");

export const Listbox = { Root, Content, Item, Label: ArkListbox.Label, NoteInput, NoteTextarea };
