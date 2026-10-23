import { ReservedLine } from "../ink/ReservedLine";
import { writeText } from "../app/clipboard";
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import type { ToolCall } from "@contracts/agent/ToolCall";
import { copy } from "../copy";
import { Collapsible } from "../ui/Collapsible";
import { Tip } from "../ui/Tip";
import { useConnectedProject } from "../state/connectedProject";

const STATES = { running: copy.toolCallRunning, done: copy.toolCallDone, failed: copy.toolCallFailed } as const;

const COPIED_MS = 1500;

/** Whole seconds under a minute, then minutes and seconds (as the step line of U456 reads). */
const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds === 0 && ms > 0) return copy.toolCallUnderSecond;

  return seconds < 60 ? copy.toolCallSeconds(seconds) : copy.toolCallMinutes(Math.floor(seconds / 60), seconds % 60);
};

/** U3780c: the plain text a fold shows, with its own `Copy`. */
const Payload = (props: { label: string; text: string | undefined }): JSX.Element => {
  const { app } = useConnectedProject();
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle");
  const [failure, setFailure] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(timer));

  const write = async (text: string) => {
    try {
      await writeText(app, text);
      setState("copied");
      setFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setState("failed");
      setFailure(copy.copyDraftFailure(error.message));
    }

    clearTimeout(timer);
    timer = setTimeout(() => setState("idle"), COPIED_MS);
  };

  return <section class="call-payload">
    <header class="call-payload-head">
      <h3 class="call-payload-label">{props.label}</h3>
      <Show when={props.text !== undefined}>
        <button type="button" data-button="quiet" class="call-copy" onClick={() => void write(props.text!)}>{state() === "copied" ? copy.toolCallCopied : state() === "failed" ? copy.toolCallCopyFailed : copy.toolCallCopy}</button>
      </Show>
    </header>
    <ReservedLine message={failure()} />
    <Show when={props.text !== undefined} fallback={<p class="call-none">{copy.toolCallNoResult}</p>}><pre class="call-text">{props.text}</pre></Show>
  </section>;
};

/** U3780b, U3780c: one Agent's current or last tool call as a line that folds open to its arguments and result. */
export const ToolCallLine = (props: { name: string; call: ToolCall }): JSX.Element => {
  const { reducedMotion } = useConnectedProject();
  const running = () => props.call.state === "running";
  const [now, setNow] = createSignal(Date.now());
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const onVisibility = () => setVisible(document.visibilityState !== "hidden");

  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));

  createEffect(() => {
    if (!running() || !visible()) return;

    setNow(Date.now());

    const timer = setInterval(() => setNow(Date.now()), 1000);

    onCleanup(() => clearInterval(timer));
  });

  const time = () => elapsed(running() ? now() - props.call.started : props.call.duration_ms ?? 0);
  const label = () => STATES[props.call.state];

  return <Collapsible.Root class="call" data-reduced-motion={reducedMotion() ? "true" : undefined}>
    <Tip text={props.call.summary ?? props.call.tool} disabled={!props.call.summary}>{(trigger, focus) =>
      <div class="overview-entry call-line">
        <Collapsible.Trigger {...focus} class="call-trigger" data-button="quiet" data-feedback="ink" aria-label={[props.name, props.call.tool, props.call.summary, label()].filter(Boolean).join(" ")}>
          <span class="call-chevron" aria-hidden="true" />
          <span class="call-agent">{props.name}</span>
          <span class="call-tool">{props.call.tool}</span>
          <span {...trigger()} class="call-summary">{props.call.summary}</span>
        </Collapsible.Trigger>
        <span class="call-state" data-tone={props.call.state === "failed" ? "red" : undefined}>{label()}</span>
        <span class="call-time">{time()}</span>
      </div>
    }</Tip>
    <Collapsible.Content class="call-fold">
      <Payload label={copy.toolCallArguments} text={props.call.arguments} />
      <Payload label={copy.toolCallResult} text={props.call.result} />
    </Collapsible.Content>
  </Collapsible.Root>;
};
