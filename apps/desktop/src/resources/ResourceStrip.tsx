import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Resources } from "@contracts/project/Resources";
import { useConnectedProject } from "../state/connectedProject";
import { cpuText, sizeText } from "./format";
import "./styles.css";

/** U408: how often `project.resources` is called while the strip is shown. */
const POLL_MS = 2000;

const isRunning = (node: RailNode): boolean => node.status !== null && node.status.kind !== "done";

const Num = (props: { text: string }) => <span class="resource-num">{props.text}</span>;

/** U408: a one-line strip between the Pane and the Thread with the selected Agent's memory, CPU and disk and the Project's totals; none of it is on the Rail. */
export const ResourceStrip = () => {
  const { app, rail, daemonExit } = useConnectedProject();
  const [result, setResult] = createSignal<Resources | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const running = createMemo(() => rail.nodes.some(isRunning));
  const live = () => running() && visible() && daemonExit() === null;

  const own = createMemo(() => {
    const node = rail.nodes.find((candidate) => candidate.id === rail.selected());

    return node && isRunning(node) ? node.id : null;
  });

  const onVisibility = () => setVisible(document.visibilityState !== "hidden");

  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));

  // No call is pending twice at once, and none is made while the strip is not shown.
  let pending = false;

  createEffect(() => {
    if (!live()) return;

    let current = true;

    const poll = () => {
      if (pending) return;

      pending = true;

      const selected = untrack(rail.selected);

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
    <Show when={running()}>
      <div class="resource-strip" role="status" aria-live="off" aria-hidden="false">
        <Show when={own() !== null}>
          <span class="resource-agent" title="resident memory · CPU of one core · Worktree on disk">
            memory <Num text={sizeText(mine()?.memory_bytes)} /> · cpu <Num text={cpuText(mine()?.cpu_percent)} /> · disk <Num text={sizeText(mine()?.disk_bytes)} />
          </span>
        </Show>
        <Show when={failed()}>
          <span class="resource-stale">not updating</span>
        </Show>
        <span class="resource-project">
          project <Num text={sizeText(result()?.total.memory_bytes)} /> · <Num text={cpuText(result()?.total.cpu_percent)} /> · <Num text={sizeText(result()?.total.disk_bytes)} />
        </span>
      </div>
    </Show>
  );
};

