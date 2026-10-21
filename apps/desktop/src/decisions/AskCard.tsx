import { copy } from "../copy";
import { batch, createMemo, createSignal, For, Show } from "solid-js";
import * as v from "valibot";
import { Markdown } from "../plain/Markdown";
import type { PromptIdentity } from "@contracts/decision/PromptIdentity";
import { useConnectedProject } from "../state/connectedProject";
import { promptKey } from "./decisions";
import { Listbox } from "../ui/Listbox";

const json = v.pipe(v.string(), v.parseJson());

const answerSchema = v.object({ label: v.string(), description: v.string(), preview: v.optional(v.string()) });

const questionSchema = v.pipe(json, v.object({ question: v.string(), answers: v.array(answerSchema) }));

export type Question = v.InferOutput<typeof questionSchema>;

/** The question an `ask_user` Decision carries (H14), or null when its payload is not readable. */
export const questionOf = (args: string): Question | null => {
  const result = v.safeParse(questionSchema, args);

  return result.success ? result.output : null;
};

const RECOMMENDED = " (recommended)";

const NOTE_MAX = 2000;

const value = (at: number | null) => (at === null ? null : String(at));

const position = (answer: string | null) => (answer === null ? null : Number(answer));

/** U406: the answers of an `ask_user` Decision with their tradeoffs, the focused answer's preview, and the note. `focus` is the focused row; `null` is none: the user's own answer. Ark's Listbox moves it, wrapping through none. */
export const AskCard = (props: { question: Question; identity: PromptIdentity; stuck: () => boolean; selectedRevision?: string | undefined }) => {
  const { drafts, decisions } = useConnectedProject();
  const identity = props.identity;
  const destination = { surface: "decisions", object: promptKey(identity), recipient: identity.agent };
  const answers = () => props.question.answers;

  const records = () => drafts.list().filter(draft => draft.destination.surface === destination.surface
    && (draft.destination.object === destination.object || draft.destination.object === identity.decision)
    && draft.value.decision === identity.decision && draft.value.agent === identity.agent && draft.destination.recipient === destination.recipient
    && draft.value.daemon === identity.daemon && draft.value.attempt === identity.attempt);

  const selectedRevision = props.selectedRevision;
  const [revision, setRevision] = createSignal(selectedRevision);

  // Recovered edits stay independently selectable; they never become the ordinary current form.
  const current = () => selectedRevision === undefined
    ? records().filter(draft => draft.value.selectedRevision === undefined).at(-1)
    : records().find(draft => draft.revision === revision());

  const restorable = () => selectedRevision === undefined || current() !== undefined && decisions.availability(identity) !== "unavailable";

  const focus = () => {
    const choice = v.safeParse(v.nullable(v.string()), current()?.value.choice);

    return choice.success ? choice.output === null ? null : answers().findIndex(answer => answer.label === choice.output) : answers().length > 0 ? 0 : null;
  };

  const note = () => {
    const parsed = v.safeParse(v.string(), current()?.value.note);

    return parsed.success ? parsed.output : "";
  };

  let field: HTMLTextAreaElement | undefined;
  const caret = () => field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : null;

  const edit = (choice: string | null, note: string) => batch(() => {
    const form = selectedRevision === undefined ? { ...identity, choice, note } : { ...identity, choice, note, selectedRevision };
    const replaces = current()?.revision ?? null;
    const result = drafts.edit(destination, form, caret(), "ordinary", replaces);

    if (selectedRevision !== undefined) setRevision(result.draft.revision);

    return result;
  });

  const retainSelection = () => {
    const draft = current();

    // Pointer navigation clears the browser selection after focus leaves; that is not a user edit.
    if (draft && document.activeElement === field) drafts.setSelection(draft.revision, caret());
  };

  const focused = createMemo(() => {
    const at = focus();

    return at === null ? undefined : answers()[at];
  });

  const sendable = () => restorable() && (selectedRevision === undefined || decisions.availability(identity) === "available") && !props.stuck() && !records().some(draft => draft.status === "pending" || draft.status === "unknown") && (focused() !== undefined || note().trim() !== "");

  const send = () => {
    if (!sendable()) return;
    const draft = current() ?? edit(focused()?.label ?? null, note()).draft;

    if (!drafts.submit(draft.revision)) return;
    void decisions.answer(identity.decision, focused()?.label ?? null, note(), identity).then(outcome => drafts.settle(draft.revision, outcome));
  };

  const items = () => answers().map((each, at) => ({
    value: String(at),
    label: each.label.endsWith(RECOMMENDED) ? each.label.slice(0, -RECOMMENDED.length) : each.label,
    description: each.description,
    recommended: each.label.endsWith(RECOMMENDED),
  }));

  const select = (at: number | null) => {
    const next = at !== null ? answers()[at]?.label ?? null : null;

    if (next !== (focused()?.label ?? null)) edit(next, note());
  };

  return (
    <Show when={restorable()}>
      <Listbox.Root answers={items()} value={value(focus())} highlightedValue={value(focus())} pending={props.stuck()} disabled={false}
        onValueChange={(answer) => select(position(answer))} onHighlightChange={(answer) => select(position(answer))}>
        <Show when={answers().length > 0}>
          <Listbox.Content class="ask-answers" aria-label={copy.answers}>
            <For each={items()}>
              {(each) => (
                <Listbox.Item item={each}>
                  <Show when={each.recommended}>
                    <span class="ask-recommended light">{copy.recommended}</span>
                  </Show>
                </Listbox.Item>
              )}
            </For>
          </Listbox.Content>
        </Show>
        <Show when={focused()?.preview}>
          {(preview) => (
            <div class="ask-preview">
              <p class="ask-preview-head light">{focused()!.label}</p>
              <Markdown class="decision-preview" body={preview()} />
            </div>
          )}
        </Show>
        <form class="ask-note" onSubmit={(submit) => { submit.preventDefault(); send(); }}>
          <Listbox.NoteTextarea
            rows={1}
            ref={element => {
              field = element;
              queueMicrotask(() => {
                const selection = current()?.selection;

                if (!element.isConnected) return;

                if (selectedRevision !== undefined) element.focus();

                if (selection) element.setSelectionRange(selection.start, selection.end, selection.direction);
              });
            }}
            onSelect={retainSelection} onKeyUp={retainSelection} onClick={retainSelection}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
            }}
            maxLength={NOTE_MAX}
            aria-label={copy.note}
            placeholder={focused() ? copy.noteForOrYourOwnAnswer(focused()!.label) : copy.yourOwnAnswer}
            value={note()}
            onInput={(input) => edit(focused()?.label ?? null, input.currentTarget.value)}
          />{" "}
          <button data-button="quiet" type="submit" class="word" aria-disabled={sendable() ? undefined : true}>{copy.send}</button>
        </form>
      </Listbox.Root>
    </Show>
  );
};
