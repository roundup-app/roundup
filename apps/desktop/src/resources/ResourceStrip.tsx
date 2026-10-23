import { copy } from "../copy";
import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Resources } from "@contracts/project/Resources";
import { useConnectedProject } from "../state/connectedProject";
import { Icon } from "../ink/Icon";
import { Tip } from "../ui/Tip";
import { cpuText, MISSING, sizeText } from "./format";
import { WorktreeControl } from "../changes/WorktreeControl";
import { HintLine } from "../keys/HintLine";
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
export const ResourceStrip = () => {
  const { app, rail, daemonExit } = useConnectedProject();
  const [result, setResult] = createSignal<Resources | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");

  const own = createMemo(() => {
    const node = rail.nodes.find((candidate) => candidate.id === rail.selected());

    return node?.id ?? null;
  });

  const live = () => visible() && daemonExit() === null && rail.nodes.some((node) => node.id === own() && isRunning(node));

  const onVisibility = () => setVisible(document.visibilityState !== "hidden");

  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));

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

  return (
    <div class="resource-strip" data-flat-bar="" role="status" aria-live="off" aria-hidden="false">
      <HintLine />
      {/* Keep this child mounted so resource updates preserve the Terminal tabs portalled into this bar. */}
      <span class="resource-agent">
        <WorktreeControl />
        <Show when={own() !== null}>
          <Values memory={sizeText(mine()?.memory_bytes)} cpu={cpuText(mine()?.cpu_percent)} disk={sizeText(mine()?.disk_bytes)} />
        </Show>
      </span>
      <Show when={own() !== null && failed()}>
        <span class="resource-stale">{copy.notUpdating}</span>
      </Show>
    </div>
  );
};
