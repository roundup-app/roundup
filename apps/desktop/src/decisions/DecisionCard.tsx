import { createMemo, For, Show } from "solid-js";
import * as v from "valibot";
import type { Decision } from "@contracts/decision/Decision";
import { ErrorLine } from "../ink/ErrorLine";
import { Markdown } from "../plain/Markdown";
import { useConnectedProject } from "../state/connectedProject";
import { AskCard, questionOf } from "./AskCard";
import "./styles.css";

const json = v.pipe(v.string(), v.parseJson());

const commandSchema = v.pipe(json, v.object({ command: v.string() }));

/** The command of a tool call when it has one, else the arguments as the Daemon sent them, indented when they are JSON. */
const readable = (args: string): string => {
  const command = v.safeParse(commandSchema, args);

  if (command.success) return command.output.command;

  const parsed = v.safeParse(json, args);

  return parsed.success ? JSON.stringify(parsed.output, null, 2) : args;
};

/** The Decision an Agent waits on, with the buttons that answer it; `focusTerminal` hands the keyboard to that Agent's Terminal. */
export const DecisionCard = (props: { decision: Decision; name: string; focusTerminal: () => void; ref: (card: HTMLElement) => void; onFocusIn: () => void; onFocusOut: (leave: FocusEvent) => void }) => {
  const { decisions, daemonExit } = useConnectedProject();
  const id = () => props.decision.id;
  const asked = createMemo(() => (props.decision.tool === "ask_user" ? questionOf(props.decision.args) : null));
  const unreadable = () => props.decision.tool === "ask_user" && asked() === null;

  const answers = () => {
    if (!props.decision.answerable || unreadable()) return [];

    return asked() ? [] : ["allow", "deny"];
  };

  const stuck = () => daemonExit() !== null || decisions.answering(id());

  return (
    <section class="decision-card" aria-label={`Decision for ${props.name}`} ref={props.ref} onFocusIn={props.onFocusIn} onFocusOut={props.onFocusOut}>
      <Show
        when={asked()}
        fallback={
          <>
            <p class="decision-title">
              <span>{props.name}</span> <span class="light">{props.decision.tool}</span>
            </p>
            <pre class="decision-args">{readable(props.decision.args)}</pre>
          </>
        }
      >
        {(question) => (
          <>
            <p class="decision-title ink" data-tone="amber">
              {props.name} asks
            </p>
            <Markdown class="decision-question" body={question().question} />
          </>
        )}
      </Show>
      <Show when={unreadable()}>
        <ErrorLine message="unreadable question: answer in the Terminal" />
      </Show>
      <Show when={!props.decision.answerable && !unreadable()}>
        <p class="light">answer in the Terminal</p>
      </Show>
      <Show when={decisions.answerFailure(id())}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={props.decision.answerable ? asked() : null} keyed>
        {(question) => <AskCard question={question} stuck={stuck} send={(answer, note) => void decisions.answer(id(), answer, note)} />}
      </Show>
      <div class="decision-buttons">
        <For each={answers()}>
          {(each) => (
            <button data-button={each === "deny" ? "primary" : "quiet"} type="button" class="word" aria-disabled={stuck() ? true : undefined} onClick={() => { if (!stuck()) void decisions.answer(id(), each); }}>
              {each}
            </button>
          )}
        </For>
        <Show when={answers().length === 0 && !(props.decision.answerable && asked())}>
          <button data-button="quiet" type="button" class="word" onClick={props.focusTerminal}>
            focus Terminal
          </button>
        </Show>
      </div>
    </section>
  );
};
