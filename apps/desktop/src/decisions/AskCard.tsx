import { createMemo, createSignal, For, Show } from "solid-js";
import * as v from "valibot";
import { Markdown } from "../plain/Markdown";

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

/** U406: the answers of an `ask_user` Decision with their tradeoffs, the focused answer's preview, and a note field. */
export const AskCard = (props: { question: Question; stuck: () => boolean; send: (answer: string | null, note: string) => void }) => {
  const answers = () => props.question.answers;
  // `null` is none focused: the user's own answer.
  const [focus, setFocus] = createSignal<number | null>(answers().length > 0 ? 0 : null);

  const [note, setNote] = createSignal("");

  const focused = createMemo(() => {
    const at = focus();

    return at === null ? undefined : answers()[at];
  });

  const sendable = () => !props.stuck() && (focused() !== undefined || note().trim() !== "");

  const move = (key: KeyboardEvent) => {
    const count = answers().length;

    if (count === 0 || (key.key !== "ArrowDown" && key.key !== "ArrowUp")) return;

    key.preventDefault();

    // The positions are the rows, then none.
    const at = focus() ?? count;
    const next = (at + (key.key === "ArrowDown" ? 1 : count)) % (count + 1);

    setFocus(next === count ? null : next);
  };

  const send = () => {
    if (sendable()) props.send(focused()?.label ?? null, note());
  };

  return (
    <>
      <Show when={answers().length > 0}>
        <div class="ask-answers" role="listbox" aria-label="answers" tabIndex={0} onKeyDown={move}>
          <For each={answers()}>
            {(each, index) => (
              <div class="ask-answer" role="option" aria-selected={focus() === index()} aria-disabled={props.stuck() ? true : undefined} onClick={() => { if (!props.stuck()) setFocus(index()); }}>
                <span class="ask-label">{each.label.endsWith(RECOMMENDED) ? each.label.slice(0, -RECOMMENDED.length) : each.label}</span>
                <Show when={each.label.endsWith(RECOMMENDED)}>
                  <span class="ask-recommended light">recommended</span>
                </Show>
                <span class="ask-description">{each.description}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={focused()?.preview}>
        {(preview) => (
          <div class="ask-preview">
            <p class="ask-preview-head light">{focused()!.label}</p>
            <Markdown class="decision-preview" body={preview()} />
          </div>
        )}
      </Show>
      <div class="ask-note">
        <input
          type="text"
          maxLength={NOTE_MAX}
          aria-label="note"
          placeholder={focused() ? `note for ${focused()!.label}, or your own answer` : "your own answer"}
          value={note()}
          readOnly={props.stuck()}
          aria-disabled={props.stuck() ? true : undefined}
          onInput={(input) => setNote(input.currentTarget.value)}
          onKeyDown={(key) => {
            if (key.key === "Enter") send();
            else move(key);
          }}
        />{" "}
        <button data-button="quiet" type="button" class="word" aria-disabled={sendable() ? undefined : true} onClick={send}>
          send
        </button>
      </div>
    </>
  );
};
