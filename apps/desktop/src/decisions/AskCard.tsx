import { copy } from "../copy";
import { createMemo, createSignal, For, Show } from "solid-js";
import * as v from "valibot";
import { Markdown } from "../plain/Markdown";
import { Listbox } from "../ui";

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
export const AskCard = (props: { question: Question; stuck: () => boolean; send: (answer: string | null, note: string) => void }) => {
  const answers = () => props.question.answers;
  const [focus, setFocus] = createSignal<number | null>(answers().length > 0 ? 0 : null);
  const [note, setNote] = createSignal("");

  const focused = createMemo(() => {
    const at = focus();

    return at === null ? undefined : answers()[at];
  });

  const sendable = () => !props.stuck() && (focused() !== undefined || note().trim() !== "");

  const send = () => {
    if (sendable()) props.send(focused()?.label ?? null, note());
  };

  const items = () => answers().map((each, at) => ({
    value: String(at),
    label: each.label.endsWith(RECOMMENDED) ? each.label.slice(0, -RECOMMENDED.length) : each.label,
    description: each.description,
    recommended: each.label.endsWith(RECOMMENDED),
  }));

  const select = (at: number | null) => setFocus(at !== null && answers()[at] === undefined ? null : at);

  return (
    <Listbox.Root answers={items()} value={value(focus())} highlightedValue={value(focus())} pending={props.stuck()}
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
        <Listbox.NoteInput
          maxLength={NOTE_MAX}
          aria-label={copy.note}
          placeholder={focused() ? copy.noteForOrYourOwnAnswer(focused()!.label) : copy.yourOwnAnswer}
          value={note()}
          onInput={(input) => setNote(input.currentTarget.value)}
        />{" "}
        <button data-button="quiet" type="submit" class="word" aria-disabled={sendable() ? undefined : true}>{copy.send}</button>
      </form>
    </Listbox.Root>
  );
};
