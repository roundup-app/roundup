import { copy } from "../copy";
import { createMemo, createResource, For, on, Show } from "solid-js";
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
  const { app, decisions, daemonExit, rail } = useConnectedProject();
  const id = createMemo(() => props.decision.id);
  // A refusal refresh changes the Decision, not its question; keep the user's answer draft mounted.
  const questionArgs = createMemo(() => props.decision.tool === "ask_user" ? props.decision.args : null);
  const asked = createMemo(on([id, questionArgs], ([, args]) => args === null ? null : questionOf(args)));

  const [prompt, { refetch }] = createResource(() => asked() ? id() : false, async (id) => {
    try { return { identity: await app.rpc("decision.capture", { id }), failure: null }; }
    catch (error) {
      if (!(error instanceof Error)) throw error;

      return { identity: null, failure: error.message };
    }
  });

  const unreadable = () => props.decision.tool === "ask_user" && asked() === null;

  const answers = () => {
    if (!props.decision.answerable || unreadable()) return [];

    return asked() ? [] : ["allow", "deny"];
  };

  const stuck = () => daemonExit() !== null || decisions.answering(id());

  return (
    <section class="decision-card" aria-label={copy.decisionFor(props.name)} ref={props.ref} onFocusIn={props.onFocusIn} onFocusOut={props.onFocusOut}>
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
              {props.name}{copy.asks}</p>
            <Markdown class="decision-question" body={question().question} />
          </>
        )}
      </Show>
      <Show when={unreadable()}>
        <ErrorLine message="Unreadable question: Answer in the Terminal" />
      </Show>
      <Show when={!props.decision.answerable && !unreadable()}>
        <p class="light">{copy.answerInTheTerminal}</p>
      </Show>
      <Show when={props.decision.failure}>
        {(failure) => <ErrorLine message={copy.answerRefused(rail.nodes.find((node) => node.id === failure().answered_by.id)?.name ?? failure().answered_by.id, failure().message)} />}
      </Show>
      <Show when={decisions.answerFailure(id())}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={props.decision.answerable ? asked() : null} keyed>
        {(question) => <>
          <Show when={prompt()?.failure}>{message => <><ErrorLine message={message()} /><button type="button" data-button="quiet" onClick={() => void refetch()}>Retry</button></>}</Show>
          <Show when={!prompt.loading ? prompt()?.identity : null} keyed>{identity => <AskCard question={question} identity={identity} stuck={stuck} />}</Show>
        </>}
      </Show>
      <div class="decision-buttons">
        <For each={answers()}>
          {(each) => (
            <button data-button={each === "allow" ? "primary" : "quiet"} type="button" class="word" aria-disabled={stuck() ? true : undefined} onClick={() => { if (!stuck()) void decisions.answer(id(), each); }}>
              {each === "allow" ? copy.allow : copy.deny}
            </button>
          )}
        </For>
        <Show when={answers().length === 0 && !(props.decision.answerable && asked())}>
          <button data-button="quiet" type="button" class="word" onClick={props.focusTerminal}>{copy.focusTerminal}</button>
        </Show>
      </div>
    </section>
  );
};
