import { makeEventListener } from "@solid-primitives/event-listener";
import { createInlineEdit, definePrimitive } from "@ui-sdk/core";
import { usePart, usePrimitive } from "@ui-sdk/solid/primitive";
import { createContext, createEffect, createMemo, createSignal, createUniqueId, omit, onCleanup, onSettled, untrack, useContext, type Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as v from "valibot";
import { captureFocus } from "../keys/focus";
import { useConnectedProject } from "../state/connectedProject";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { withOptions } from "./primitiveOptions";
import { outcomeOf } from "../app/seam";

type SessionOptions = { current?: () => string; commit?: (text: string) => boolean; disabled?: () => boolean };

type SessionState = { editing: string | null };

const defined = definePrimitive({
  name: "editable",
  options: { current: "value", commit: "action", disabled: "value" },
  state: (_options: SessionOptions): SessionState => ({ editing: null }),
  api: context => ({
    edit: createInlineEdit(context, {
      key: "editing",
      value: () => context.options().current?.() ?? "",
      commit: (_id, text) => context.options().commit?.(text) ?? true,
      disabled: () => context.options().disabled?.() ?? false,
    }),
  }),
  slots: slot => ({ root: slot({}) }),
});

const session = withOptions(defined);

type RootProps = {
  class?: string;
  children?: JSX.Element;
  /** The caller decides when editing starts and ends: `true` starts a session, `false` cancels it. */
  edit?: boolean;
  value?: string;
  defaultValue?: string;
  readOnly?: boolean;
  /** `keys` starts editing on Enter, F2, typing or a double click of the preview; `none` leaves starting to the caller. */
  activationMode?: "keys" | "none";
  /** `both` saves on Enter, Tab and when focus leaves; `enter` saves on Enter and cancels when focus leaves; `none` leaves both to the caller. */
  submitMode?: "both" | "enter" | "none";
  /** `false` puts the caret at the end of the text when editing starts, instead of selecting it. */
  selectOnFocus?: boolean;
  placeholder?: string;
  translations?: { edit?: string };
  finalFocusEl?: () => HTMLElement | null | undefined;
  onValueChange?: (details: { value: string }) => void;
  onValueCommit?: (details: { value: string }) => void;
  onEditChange?: (details: { edit: boolean }) => void;
};

const optionKeys = ["edit", "value", "defaultValue", "readOnly", "activationMode", "submitMode", "selectOnFocus", "placeholder", "translations", "finalFocusEl", "onValueChange", "onValueCommit", "onEditChange"] as const satisfies readonly (keyof RootProps)[];

type Api = { edit: () => void; cancel: () => void; submit: () => void };

/** One field's edit session, kept by ui-sdk's `createInlineEdit`; the text, the callbacks and the focus around it are this field's. */
const createEditable = (props: RootProps) => {
  const id = createUniqueId();
  const inputId = `${id}-input`;
  const previewId = `${id}-preview`;
  // A prop written as a conditional builds its own memo on every read, which no effect callback may do: the caller's value is read through this one.
  const controlled = createMemo(() => props.value);
  const [stored, setStored] = createSignal(untrack(() => controlled() ?? props.defaultValue ?? ""));
  const [editing, setEditing] = createSignal(false);
  const text = () => controlled() ?? stored();
  const interactive = () => !props.readOnly;
  const submitMode = () => props.submitMode ?? "both";
  let baseline = "";
  let committed = false;
  let driven = false;
  let forcing = false;
  let ending = false;

  const setText = (next: string) => {
    if (next === untrack(text)) return;

    if (controlled() === undefined) setStored(next);
    props.onValueChange?.({ value: next });
  };

  const handle = usePrimitive(session, () => ({
    current: () => running() ? baseline : untrack(text),
    commit: (value: string) => {
      if (ending) return true;
      committed = true;
      props.onValueCommit?.({ value });

      return true;
    },
    disabled: () => !interactive() && !forcing,
  }));

  const edit = handle.api.edit;
  const running = (): boolean => handle.state.editing !== null;

  const settle = () => {
    if (!committed) setText(baseline);
    const permission = captureFocus();

    // The helper puts focus back where it was; a field whose neighbour was replaced while it edited names where focus goes instead.
    requestAnimationFrame(() => permission(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      props.finalFocusEl?.()?.focus({ preventScroll: true });
    }));
  };

  onSettled(() => {
    const read = () => setEditing(running());

    read();

    return handle.instance.subscribe(read);
  });

  createEffect(editing, on => {
    const echo = driven;

    driven = false;

    if (!on) settle();

    if (!echo) props.onEditChange?.({ edit: on });
  }, { defer: true });

  // The text a session starts from is what its end compares with and what a cancel puts back.
  createEffect(editing, on => {
    if (!on) return;
    baseline = untrack(text);
    committed = false;
    const field = document.getElementById(inputId);

    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    let unbind: (() => void) | undefined;

    // The field takes focus as the library's own move: a caller's permission to focus it, captured before this, still holds.
    captureFocus()(() => { unbind = edit.bindInput(field); });

    if (untrack(() => props.selectOnFocus) === false) field.setSelectionRange(field.value.length, field.value.length);

    return unbind;
  });

  // A caller that sets `edit` starts a read-only field too: the field shows, and only a person's own start is refused.
  createEffect(() => props.edit, wanted => {
    if (wanted === undefined || wanted === running()) return;
    driven = true;
    forcing = true;

    if (wanted) edit.start(id);
    else {
      // The caller that ends the session owns focus, so this is the library's end without its return of focus to where the edit began, and it commits nothing.
      ending = true;
      edit.end("focus-out");
      ending = false;
    }

    forcing = false;
  });

  const api: Api = {
    edit: () => { edit.start(id); },
    cancel: () => edit.cancel(),
    submit: () => { edit.end("imperative"); },
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || submitMode() === "none" || (event.key === "Tab" && submitMode() !== "both")) return;
    edit.inputKeydown(event);
  };

  const focusOut = (event: FocusEvent) => {
    if (submitMode() === "both") edit.end("focus-out", event);
    else if (submitMode() === "enter") edit.cancel();
  };

  const activate = {
    keyDown: (event: KeyboardEvent) => { if (props.activationMode !== "none") edit.keydown(event, id); },
    dblClick: (event: MouseEvent) => { if (props.activationMode !== "none") edit.dblclick(event, id); },
  };

  return { handle, inputId, previewId, props, editing, text, setText, interactive, api, keyDown, focusOut, activate, previewText: () => text().trim() === "" ? props.placeholder ?? "" : text() };
};

const EditableContext = createContext<ReturnType<typeof createEditable>>();

const Root = (props: RootProps): JSX.Element => {
  const editable = createEditable(props);

  return <EditableContext value={editable}>{usePart(editable.handle, "root", undefined, omit(props, ...optionKeys), "div")}</EditableContext>;
};

const Context = (props: { children: (api: Accessor<Api>) => JSX.Element }): JSX.Element => {
  const editable = useContext(EditableContext);

  return untrack(() => props.children(() => editable.api));
};

const Area = (props: { style?: JSX.CSSProperties; children?: JSX.Element }): JSX.Element => (
  <div data-slot="editable-area" style={{ display: "inline-grid", ...props.style }}>{props.children}</div>
);

/** What a caller who draws the part as its own element spreads on it; the caller's own `ref` goes on that element. */
type Attributes = Omit<JSX.HTMLAttributes<HTMLElement>, "ref">;

type PreviewProps = Omit<Attributes, "onDblClick" | "onKeyDown" | "style" | "children"> & {
  style?: JSX.CSSProperties;
  onDblClick?: (event: MouseEvent & { currentTarget: HTMLElement }) => void;
  onKeyDown?: (event: KeyboardEvent & { currentTarget: HTMLElement }) => void;
  asChild?: (attributes: Accessor<Attributes>) => JSX.Element;
};

const Preview = (props: PreviewProps): JSX.Element => {
  const editable = useContext(EditableContext);
  const rest = omit(props, "asChild", "style", "onDblClick", "onKeyDown");

  const attributes = (): Attributes => ({
    "data-slot": "editable-preview",
    id: editable.previewId,
    "aria-label": editable.props.translations?.edit ?? "edit",
    "aria-readonly": editable.interactive() ? undefined : "true",
    children: editable.previewText(),
    tabindex: editable.interactive() ? 0 : undefined,
    ...rest,
    style: {
      "white-space": "pre",
      "grid-area": "1 / 1 / auto / auto",
      overflow: "hidden",
      "text-overflow": "ellipsis",
      visibility: editable.editing() ? "hidden" : undefined,
      ...props.style,
    },
    onKeyDown: event => {
      props.onKeyDown?.(event);

      if (!event.defaultPrevented) editable.activate.keyDown(event);
    },
    onDblClick: event => {
      props.onDblClick?.(event);

      if (!event.defaultPrevented) editable.activate.dblClick(event);
    },
  });

  return <>{props.asChild ? props.asChild(attributes) : <span {...attributes()} />}</>;
};

type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onInput" | "onKeyDown" | "onFocusOut" | "style"> & {
  style?: JSX.CSSProperties;
  onInput?: (event: InputEvent & { currentTarget: HTMLInputElement; target: HTMLInputElement }) => void;
  onKeyDown?: (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
  onFocusOut?: (event: FocusEvent & { currentTarget: HTMLInputElement }) => void;
  asChild?: (attributes: Accessor<Attributes>) => JSX.Element;
};

const Input = (props: InputProps): JSX.Element => {
  const editable = useContext(EditableContext);
  const rest = omit(props, "asChild", "style", "onInput", "onKeyDown", "onFocusOut");

  const attributes = (): JSX.InputHTMLAttributes<HTMLInputElement> => ({
    "data-slot": "editable-input",
    id: editable.inputId,
    readonly: !editable.interactive(),
    placeholder: editable.props.placeholder,
    size: 1,
    value: editable.text(),
    ...rest,
    style: {
      "grid-area": "1 / 1 / auto / auto",
      visibility: editable.editing() ? undefined : "hidden",
      ...props.style,
    },
    onInput: event => {
      props.onInput?.(event);
      editable.setText(event.currentTarget.value);
    },
    onKeyDown: event => {
      props.onKeyDown?.(event);
      editable.keyDown(event);
    },
    onFocusOut: event => {
      props.onFocusOut?.(event);

      if (!event.defaultPrevented) editable.focusOut(event);
    },
  });

  // A caller may draw the field as a textarea: it receives the input's attributes, and its handlers only read `value` and the selection.
  // SAFETY: an input's attributes differ from the general ones only in the element their handlers name as `currentTarget`; a textarea has the `value` and selection the handlers read.
  const asAttributes = attributes as Accessor<Attributes>;

  return <>{props.asChild ? props.asChild(asAttributes) : <input {...attributes()} class={`field-inline ${props.class ?? ""}`} />}</>;
};

export const Editable = { Root, Context, Area, Preview, Input };

const nameSchema = v.strictObject({ text: v.string(), base: v.string(), version: v.nullable(v.string()) });

/** Row edits keep their original object and version through navigation and a refused save. */
export const NameField = (props: {
  object: string;
  name: string;
  version: () => Promise<string | null>;
  commit: (text: string, base: string, version: string | null) => Promise<void>;
  close: (restore?: boolean) => void;
  fail: (message: string | null) => void;
}) => {
  const { drafts, project } = useConnectedProject();
  const destination = { surface: "row-name", object: props.object, recipient: null };
  drafts.validate(destination.surface, nameSchema);
  const records = () => drafts.list().filter(draft => draft.destination.surface === destination.surface && draft.destination.object === destination.object);
  const restored = records().at(-1);
  const parsed = v.safeParse(nameSchema, restored?.value);
  const [text, setText] = createSignal(parsed.success ? parsed.output.text : props.name);
  const base = parsed.success ? parsed.output.base : props.name;
  const [version, setVersion] = createSignal<string | null>(parsed.success ? parsed.output.version : null);
  const [ready, setReady] = createSignal(parsed.success);
  const [pending, setPending] = createSignal(false);
  let revision = restored?.revision ?? null;
  let alive = true;
  onCleanup(() => { alive = false; });
  onCleanup(drafts.editor(destination));

  const loading = parsed.success ? Promise.resolve(version()) : props.version().then(value => { if (alive) { setVersion(value); setReady(true); } }).catch(error => {
    if (!(error instanceof Error)) throw error;
    props.fail(error.message);
  });

  const conflict = () => props.name !== base;

  const retain = (field: HTMLInputElement) => {
    const selection = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };
    revision = drafts.edit(destination, { text: field.value, base, version: version() }, selection, "ordinary", revision).draft.revision;
  };

  const submit = async (field: HTMLInputElement) => {
    if (!ready()) await loading;

    if (!alive || !ready() || pending() || conflict() || text().trim() === "") return;
    retain(field);
    const value = text().trim();
    setPending(true);
    const submitted = revision === null ? null : await drafts.submit(revision);

    if (!submitted) {
      setPending(false);

      return;
    }

    try {
      await props.commit(value, base, version());
      drafts.settle(submitted.draft.revision, "acknowledged");

      if (alive && revision === submitted.draft.revision) { props.fail(null); props.close(); }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      drafts.settle(submitted.draft.revision, outcomeOf(error));
      props.fail(error.message);
    } finally { if (alive) setPending(false); }
  };

  createEffect(() => ({ problem: drafts.problem(), name: project.name }), ({ problem, name }) => {
    if (problem && (!problem.destination || problem.destination.object === destination.object)) props.fail(copy.draftRetention(name, copy.name, problem.cause));
  });

  // This editor restores its own selection; the editable's deferred select-all would overwrite it.
  return <Editable.Root edit selectOnFocus={false} value={text()} submitMode="none" class="row-name-editor" onValueChange={({ value }) => setText(value)}>
    <Editable.Input spellcheck={false} autocorrect="off" autocapitalize="off" type="text" class="shelf-title field-inline" aria-label={copy.name} aria-invalid={conflict() ? "true" : undefined} aria-busy={!ready() || pending() ? "true" : "false"} ref={field => {
      // A native listener: the stop must also reach document-level key handlers, which a delegated one cannot.
      makeEventListener(field, "keydown", event => {
        event.stopPropagation();

        if (event.key === "Enter") {
          event.preventDefault();

          if (!event.repeat) void submit(field);
        }

        if (event.key === "Escape") { event.preventDefault(); props.close(); }
      });

      queueMicrotask(() => {
        if (!field.isConnected) return;
        field.focus();

        if (restored?.selection) field.setSelectionRange(restored.selection.start, restored.selection.end, restored.selection.direction);
        else field.select();
      });
    }} onInput={event => { setText(event.currentTarget.value); retain(event.currentTarget); }}
    onSelect={event => { if (event.currentTarget.isConnected && revision !== null) drafts.setSelection(revision, { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0, direction: event.currentTarget.selectionDirection ?? "none" }); }}
    onBlur={() => props.close(false)} />
    <ReservedLine overlay status={conflict() ? copy.railDraftConflict : null} />
  </Editable.Root>;
};
