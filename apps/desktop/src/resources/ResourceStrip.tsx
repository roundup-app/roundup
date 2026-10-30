import { makeEventListener } from "@solid-primitives/event-listener";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Resources } from "@contracts/project/Resources";
import { useConnectedProject } from "../state/connectedProject";
import { Icon } from "../ink/Icon";
import { Tip } from "../ui/Tip";
import { cpuText, MISSING, sizeText } from "./format";
import { WorktreeControl } from "../changes/WorktreeControl";
import "./styles.css";

/** U408: how often `project.resources` is called while the strip is shown. */
const POLL_MS = 2000;

const isRunning = (node: RailNode): boolean => node.status?.kind === "working";

/** U444: one value as an icon and its number, named for a screen reader and on hover; a missing value hides with its icon. */
const Value = (props: { icon: "memory" | "cpu" | "disk"; name: string; text: string }) => (
  <Show when={props.text !== MISSING}>
    <Tip content={props.name}>
      {(trigger) => (
        <span {...trigger()} class="resource-value">
          <Icon name={props.icon} />
          <span class="resource-num">{props.text}</span>
          <span class="resource-name">{props.name}</span>
        </span>
      )}
    </Tip>
  </Show>
);

const Values = (props: { memory: string; cpu: string; disk: string }) => (
  <>
    <Value icon="memory" name="Resident memory" text={props.memory} />
    <Value icon="cpu" name="CPU of one core" text={props.cpu} />
    <Value icon="disk" name="Worktree on disk" text={props.disk} />
  </>
);

/** U444: the centre's last line, under the Terminal, with the selected Agent's memory, CPU and disk only; none of it is on the Rail. The line stays when empty. */
export const ResourceStrip = (props: { returnFocus?: (() => void) | undefined }) => {
  const { app, rail, daemonExit, hasView, hideView } = useConnectedProject();
  const [result, setResult] = createSignal<Resources | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");

  const own = createMemo(() => {
    const node = rail.nodes.find((candidate) => candidate.id === rail.selected());

    return node?.kind === "agent" || node?.kind === "workstream" && node.attempt !== null ? node.id : null;
  });

  const live = () => hasView("resources") && visible() && daemonExit() === null && rail.nodes.some((node) => node.id === own() && isRunning(node));

  const onVisibility = () => setVisible(document.visibilityState !== "hidden");

  makeEventListener(document, "visibilitychange", onVisibility);

  // No call is pending twice at once, and none is made while the strip is not shown.
  let pending = false;

  createEffect(on(own, () => {
    setResult(null);
    setFailed(false);
  }));

  createEffect(() => {
    const selected = own();

    if (!live()) return;

    let current = true;

    const poll = () => {
      if (pending) return;

      pending = true;

      void app
        .rpc("project.resources", null)
        .then(
          (sampled) => {
            if (!current || untrack(rail.selected) !== selected) return;

            setResult(sampled);
            setFailed(false);
          },
          () => {
            if (current) setFailed(true);
          },
        )
        .finally(() => {
          pending = false;
        });
    };

    poll();

    const timer = setInterval(poll, POLL_MS);

    onCleanup(() => {
      current = false;
      clearInterval(timer);
    });
  });

  const mine = () => {
    const id = own();

    return id === null ? undefined : result()?.agents.find((entry) => entry.id === id);
  };

  return (<>
    <Show when={hasView("resources") && own() !== null}><section class="resource-inspection" aria-label={copy.resources} aria-busy={live() && result() === null && !failed()}>
      <div class="resource-values"><Values memory={sizeText(mine()?.memory_bytes)} cpu={cpuText(mine()?.cpu_percent)} disk={sizeText(mine()?.disk_bytes)} />
        <Show when={!failed() && (!mine() || [sizeText(mine()?.memory_bytes), cpuText(mine()?.cpu_percent), sizeText(mine()?.disk_bytes)].every(value => value === MISSING))}><ReservedLine status={result() === null && live() ? copy.resourcesLoading : copy.resourcesEmpty} /></Show>
      </div>
      <ReservedLine class="resource-stale" aria-live="off" status={own() !== null && failed() ? copy.notUpdating : null} />
      <button type="button" data-button="quiet" onClick={() => hideView("resources")}>{copy.close}</button>
    </section></Show>
    <div class="resource-strip" aria-live="off">
      <WorktreeControl returnFocus={props.returnFocus} />
    </div>
    <span class="resource-agent" />
  </>);
};
