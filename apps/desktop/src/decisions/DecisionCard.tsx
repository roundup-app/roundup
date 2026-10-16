import { copy } from "../copy";
import { createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import type { Decision } from "@contracts/decision/Decision";
import { Collapsible, ScrollShadow } from "../ui";
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
  const { decisions, daemonExit, rail } = useConnectedProject();
  const id = createMemo(() => props.decision.id);
  // A refusal refresh changes the Decision, not its question; keep the user's answer draft mounted.
  const questionArgs = createMemo(() => props.decision.tool === "ask_user" ? props.decision.args : null);
  const asked = createMemo(on([id, questionArgs], ([, args]) => args === null ? null : questionOf(args)));
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
        <ErrorLine message={copy.unreadableQuestion} />
      </Show>
      <Show when={!props.decision.answerable && !unreadable()}>
        <p class="light">{copy.answerInTheTerminal}</p>
      </Show>
      <Show when={props.decision.failure}>
        {(failure) => <ErrorLine message={copy.answerRefused(rail.nodes.find((node) => node.id === failure().answered_by.id)?.name ?? failure().answered_by.id, failure().message)} />}
      </Show>
      <Show when={decisions.answerFailure(id())}>{(message) => <ErrorLine message={message()} />}</Show>
      <Show when={props.decision.answerable ? asked() : null} keyed>
        {(question) => <AskCard question={question} stuck={stuck} send={(answer, note) => void decisions.answer(id(), answer, note)} />}
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

/** U468: accepted answers remain readable when the live request and its hook are gone. */
export const AnsweredDecisions = (props: { agent: string | null; name: string }) => {
  const { app, events, rail, daemonExit } = useConnectedProject();
  const [revision, setRevision] = createSignal(0);

  const stop = events.subscribe((event) => {
    if (event.name === "decision.cleared") setRevision((current) => current + 1);
  });

  onCleanup(stop);

  const [records, { refetch }] = createResource(
    () => props.agent === null || daemonExit() !== null ? null : { agent: props.agent, revision: revision() },
    async ({ agent }) => {
      try {
        return { agent, answers: await app.rpc("decision.answers", { agent }), failure: null };
      } catch (failure) {
        if (!(failure instanceof Error)) throw failure;

        return { agent, answers: [], failure: failure.message };
      }
    },
  );

  // A late read for another selection must never label its answers as the current Agent's.
  const current = () => records()?.agent === props.agent ? records() : undefined;

  return (
    <Show when={current()}>
      {(loaded) => <Show when={loaded().failure !== null || loaded().answers.length > 0}>
        <section class="decision-history" aria-label={copy.answeredDecisionsFor(props.name)}>
          <Show when={loaded().failure}>
            {(message) => <><ErrorLine message={message()} /><button data-button="quiet" type="button" class="word" aria-disabled={daemonExit() !== null ? true : undefined} onClick={() => { if (daemonExit() === null) void refetch(); }}>{copy.retry}</button></>}
          </Show>
          <Show when={loaded().answers.length > 0}>
            <Collapsible.Root class="decision-history-disclosure">
              <Collapsible.Trigger data-button="quiet" class="word">{copy.answeredRequests}</Collapsible.Trigger>
              <Collapsible.Content class="decision-history-records">
                <ScrollShadow>
                  <For each={loaded().answers}>
                    {(record) => {
                      const parsed = v.safeParse(json, record.prompt);
                      const prompt = parsed.success ? JSON.stringify(parsed.output, null, 2) : record.prompt;

                      return <article class="decision-record">
                        <p class="decision-outcome">{copy.answeredOutcome(rail.nodes.find((node) => node.id === record.answered_by.id)?.name ?? record.answered_by.id)} <span aria-label={copy.acceptedAnswer}>{record.answer ?? record.note}</span></p>
                        <p class="light">{record.decision.tool}{copy.separator}<time dateTime={new Date(record.answered_at).toISOString()}>{new Date(record.answered_at).toLocaleString()}</time></p>
                        <Show when={record.kind === "question" ? questionOf(record.prompt) : null} fallback={<pre class="decision-args">{prompt}</pre>}>
                          {(question) => <>
                            <Markdown class="decision-question" body={question().question} />
                            <For each={question().answers.filter((answer) => answer.label === record.answer)}>{(answer) => <div class="decision-choice">
                              <Markdown class="decision-question" body={answer.description} />
                              <Show when={answer.preview}>{(preview) => <Markdown class="decision-question" body={preview()} />}</Show>
                            </div>}</For>
                          </>}
                        </Show>
                        <Show when={record.note !== "" && record.answer !== null}><pre class="decision-args">{record.note}</pre></Show>
                      </article>;
                    }}
                  </For>
                </ScrollShadow>
              </Collapsible.Content>
            </Collapsible.Root>
          </Show>
        </section>
      </Show>}
    </Show>
  );
};
