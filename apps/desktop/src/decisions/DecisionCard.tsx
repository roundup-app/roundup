import { copy } from "../copy";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import type { PromptIdentity } from "@contracts/decision/PromptIdentity";
import type { Decision } from "@contracts/decision/Decision";
import type { Scope } from "@contracts/decision/Scope";
import { ErrorLine } from "../ink/ErrorLine";
import { SegmentGroup } from "../ui/SegmentGroup";
import { Markdown } from "../plain/Markdown";
import { useConnectedProject } from "../state/connectedProject";
import { AskCard, questionOf } from "./AskCard";
import { plainRefusal } from "./decisions";
import { readPermission, SCOPES } from "./permission";
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

const scopeLabels: Record<Scope, string> = { once: copy.scopeOnce, session: copy.scopeSession, project: copy.scopeProject };

/** A text field keeps its own keys; the scope control's hidden radios do not count as one. */
const typingIn = (target: EventTarget | null): boolean => target instanceof Element && target.matches("textarea, select, [contenteditable]:not([contenteditable=false]), input:not([type=radio]):not([type=checkbox]):not([type=button])");

/** The Decision an Agent waits on, with the buttons that answer it; `focusTerminal` hands the keyboard to that Agent's Terminal. */
export const DecisionCard = (props: { decision: Decision; name: string; focusTerminal: () => void; ref: (card: HTMLElement) => void; onFocusIn: () => void; onFocusOut: (leave: FocusEvent) => void; onEscape?: () => void;
  /** Already observed original authority and an exact retained revision. Opening performs no capture.
   * Revisions outside this Project/Prompt are refused; unverified authority permits no Send.
   */
  selected?: { revision: string; identity: PromptIdentity } | undefined;
}) => {
  const { app, decisions, daemonExit, rail } = useConnectedProject();
  const id = createMemo(() => props.decision.id);
  // A refusal refresh changes the Decision, not its question; keep the user's answer draft mounted.
  const questionArgs = createMemo(() => props.decision.tool === "ask_user" ? props.decision.args : null);
  const asked = createMemo(on([id, questionArgs], ([, args]) => args === null ? null : questionOf(args)));

  const [prompt, { refetch }] = createResource(() => asked() && !props.selected ? id() : false, async (id) => {
    try { return { identity: await app.rpc("decision.capture", { id }), failure: null }; }
    catch (error) {
      if (!(error instanceof Error)) throw error;

      return { identity: null, failure: error.message };
    }
  });

  const editor = createMemo(() => {
    const selected = props.selected;

    if (selected) return selected.identity.decision === id() && selected.identity.agent === props.decision.agent ? selected : null;
    const identity = !prompt.loading ? prompt()?.identity : null;

    return identity ? { identity, revision: undefined } : null;
  });

  const unreadable = () => props.decision.tool === "ask_user" && asked() === null;

  const answers = () => {
    if (props.selected || !props.decision.answerable || unreadable()) return [];

    return asked() ? [] : ["allow", "deny"];
  };

  const stuck = () => daemonExit() !== null || decisions.answering(id());

  // U3794: a permission Decision the Card can answer reads as who asks, what happens and for how long.
  const permission = () => props.decision.answerable && props.decision.tool !== "ask_user" && !props.selected;
  const reading = createMemo(() => readPermission(props.decision));
  const scopes = createMemo(() => SCOPES.filter((each) => (props.decision.scopes ?? ["once"]).includes(each) && !(each === "project" && props.decision.risk === "destructive")));
  const [picked, setPicked] = createSignal<Scope>("once");
  const chosen = () => scopes().includes(picked()) ? picked() : "once";
  const titleId = () => `decision-title-${id()}`;
  const reasonId = () => `decision-reason-${id()}`;
  const effects = () => reading().effects.slice(0, 3);

  createEffect(on(id, () => setPicked("once"), { defer: true }));

  const send = (word: "allow" | "deny") => {
    if (!stuck()) void decisions.answer(id(), word, undefined, undefined, word === "allow" ? chosen() : undefined);
  };

  // Capture phase: the scope control's own arrow keys wrap, and the Card's do not.
  const keys = (key: KeyboardEvent) => {
    if (!permission() || key.defaultPrevented || key.isComposing || key.altKey || key.ctrlKey || key.metaKey || key.shiftKey || typingIn(key.target)) return;

    const at = scopes().indexOf(chosen());

    if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
      const next = scopes()[at + (key.key === "ArrowLeft" ? -1 : 1)];

      key.preventDefault();
      key.stopPropagation();

      if (next) {
        setPicked(next);
        key.currentTarget instanceof Element && key.currentTarget.querySelector<HTMLInputElement>(`input[type=radio][value="${next}"]`)?.focus();
      }
    } else if (key.key === "Enter" && !(key.target instanceof Element && key.target.closest("button"))) {
      key.preventDefault();
      key.stopPropagation();
      send("allow");
    } else if (key.key === "Escape") {
      key.preventDefault();
      key.stopPropagation();

      if (props.onEscape) props.onEscape();
      else send("deny");
    }
  };

  return (
    <section class="decision-card" aria-label={permission() ? undefined : copy.decisionFor(props.name)} aria-labelledby={permission() ? titleId() : undefined} aria-describedby={permission() && reading().reason ? reasonId() : undefined} ref={(card) => { props.ref(card); card.addEventListener("keydown", keys, true); onCleanup(() => card.removeEventListener("keydown", keys, true)); }} onFocusIn={props.onFocusIn} onFocusOut={props.onFocusOut}>
      <Show
        when={asked()}
        fallback={
          <Show when={permission()} fallback={
          <>
            <p class="decision-title">
              <span>{props.name}</span> <span class="light">{props.decision.tool}</span>
            </p>
            <pre class="decision-args">{readable(props.decision.args)}</pre>
          </>
          }>
            <div class="decision-body">
              <Show when={props.decision.risk === "destructive"}><span class="decision-tag" data-tone="red">{copy.destructive}</span></Show>
              <p class="decision-title" id={titleId()}>
                <span>{props.name}</span>{reading().verb === "run" ? copy.wantsToRun : reading().verb === "edit" ? copy.wantsToEdit : copy.wantsToUse}<code>{reading().target}</code>
              </p>
              <Show when={reading().reason}>{(reason) => <p class="decision-reason light" id={reasonId()}>{reason()}</p>}</Show>
              <Show when={effects().length > 0}>
                <ul class="decision-effects">
                  <For each={effects()}>{(effect) => <li><code>{effect.path}</code> <span class="decision-added">{copy.linesAdded(effect.added)}</span> <span class="decision-removed">{copy.linesRemoved(effect.removed)}</span></li>}</For>
                  <Show when={reading().effects.length > 3}><li class="light">{copy.effectsMore(reading().effects.length - 3)}</li></Show>
                </ul>
              </Show>
              <Show when={reading().rest}>{(rest) => <pre class="decision-args">{rest()}</pre>}</Show>
            </div>
          </Show>
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
          <Show when={!props.selected && prompt()?.failure}>{message => <div class="decision-list-failure"><ErrorLine message={plainRefusal(message())} /><button type="button" data-button="quiet" onClick={() => void refetch()}>{copy.retry}</button></div>}</Show>
          <Show when={editor()} keyed>{entry => <AskCard question={question} identity={entry.identity} stuck={stuck} selectedRevision={entry.revision} />}</Show>
        </>}
      </Show>
      <Show when={permission() && scopes().length > 1}>
        <SegmentGroup label={copy.allowFor} segments={scopes().map((value) => ({ value, label: scopeLabels[value] }))} value={chosen()} onValueChange={setPicked} />
      </Show>
      <div class="decision-buttons">
        <For each={answers()}>
          {(each) => (
            <button data-button={each === "allow" ? "primary" : "quiet"} type="button" class="word" aria-disabled={stuck() ? true : undefined} onClick={() => send(each === "allow" ? "allow" : "deny")}>
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
