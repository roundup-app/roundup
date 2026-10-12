import { createMemo, createSignal, For, Show } from "solid-js";
import * as v from "valibot";
import type { Decision } from "@contracts/decision/Decision";
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

/** U423: the question of an `ask_user` Decision the Thread can draw: readable and answerable here. */
export const askedOf = (decision: Decision): Question | null => (decision.tool === "ask_user" && decision.answerable ? questionOf(decision.args) : null);

const RECOMMENDED = " (recommended)";

const NOTE_MAX = 2000;

/** U423: the position after an arrow key among `count` answers and none (`null`), or `undefined` when the key moves nothing. */
export const moved = (count: number, focus: number | null, key: string): number | null | undefined => {
  if (count === 0 || (key !== "ArrowDown" && key !== "ArrowUp")) return undefined;

  // The positions are the rows, then none.
  const next = ((focus ?? count) + (key === "ArrowDown" ? 1 : count)) % (count + 1);

  return next === count ? null : next;
};

/** U406: the answers of an `ask_user` Decision with their tradeoffs, and the focused answer's preview. `focus` is the focused row; `null` is none: the user's own answer. */
export const AskAnswers = (props: { question: Question; stuck: () => boolean; focus: () => number | null; setFocus: (at: number | null) => void; onKeyDown?: (key: KeyboardEvent) => void }) => {
  const answers = () => props.question.answers;

  const focused = () => {
    const at = props.focus();

    return at === null ? undefined : answers()[at];
  };

  return (
    <>
      <Show when={answers().length > 0}>
        <div class="ask-answers" role="listbox" aria-label="answers" tabIndex={0} onKeyDown={props.onKeyDown}>
          <For each={answers()}>
            {(each, index) => (
              <div class="ask-answer" role="option" aria-selected={props.focus() === index()} aria-disabled={props.stuck() ? true : undefined} onClick={() => { if (!props.stuck()) props.setFocus(index()); }}>
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
    </>
  );
};

/** U406: `AskAnswers` with a note field and `send` of its own. */
export const AskCard = (props: { question: Question; stuck: () => boolean; send: (answer: string | null, note: string) => void }) => {
  const answers = () => props.question.answers;
  const [focus, setFocus] = createSignal<number | null>(answers().length > 0 ? 0 : null);
  const [note, setNote] = createSignal("");

  const focused = createMemo(() => {
    const at = focus();

    return at === null ? undefined : answers()[at];
  });

  const sendable = () => !props.stuck() && (focused() !== undefined || note().trim() !== "");

  const move = (key: KeyboardEvent) => {
    const next = moved(answers().length, focus(), key.key);

    if (next === undefined) return;

    key.preventDefault();
    setFocus(next);
  };

  const send = () => {
    if (sendable()) props.send(focused()?.label ?? null, note());
  };

  return (
    <>
      <AskAnswers question={props.question} stuck={props.stuck} focus={focus} setFocus={setFocus} onKeyDown={move} />
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
