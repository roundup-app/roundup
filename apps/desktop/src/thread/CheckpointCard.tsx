import { createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { Block } from "@contracts/checkpoint/Block";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import type { RewindPlan } from "@contracts/workstream/RewindPlan";
import type { Files } from "@contracts/workstream/Files";
import { ErrorLine } from "../ink/ErrorLine";
import { visualKinds } from "../pads/visualKinds";
import { clock } from "./lines";
import type { Rewind } from "./rewind";

const narrow = <K extends Block["kind"]>(block: Block, _kind: K) =>
  // SAFETY: each caller sits in a Match that renders only when block.kind equals the kind it passes.
  block as Extract<Block, { kind: K }>;

/** U148's SVG, or the source in a `pre` where it fails to render. */
const Diagram = (props: { mermaid: string }) => (
  <div
    class="thread-checkpoint-diagram"
    ref={(host) => {
      const mount = visualKinds().get("mermaid")!.mount;

      onCleanup(mount(host, { text: props.mermaid, readonly: true, replace: () => {} }));
    }}
  />
);

const BlockView = (props: { block: Block }) => (
  <section class="thread-checkpoint-block" data-block={props.block.kind}>
    {props.block.title !== undefined && <h4 class="thread-checkpoint-block-title">{props.block.title}</h4>}
    <Switch>
      <Match when={props.block.kind === "rows" && props.block}>
        {(block) => (
          <dl class="thread-checkpoint-rows">
            <For each={narrow(block(), "rows").rows}>
              {(row) => (
                <div class="thread-checkpoint-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              )}
            </For>
          </dl>
        )}
      </Match>
      <Match when={props.block.kind === "table" && props.block}>
        {(block) => {
          const table = () => narrow(block(), "table");

          return (
            <div class="thread-checkpoint-scroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <For each={table().head}>{(cell) => <th scope="col">{cell}</th>}</For>
                  </tr>
                </thead>
                <tbody>
                  <For each={table().rows}>
                    {(row) => (
                      <tr>
                        <For each={row}>{(cell) => <td>{cell}</td>}</For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          );
        }}
      </Match>
      <Match when={props.block.kind === "diagram" && props.block}>{(block) => <Diagram mermaid={narrow(block(), "diagram").mermaid} />}</Match>
      <Match when={props.block.kind === "text" && props.block}>
        {(block) => <p class="thread-checkpoint-text">{narrow(block(), "text").text}</p>}
      </Match>
    </Switch>
  </section>
);

const SHOWN_PATHS = 5;

const changedPaths = (plan: RewindPlan) => [...new Set(plan.agents.flatMap((each) => each.files_changed))];

/** U374: what a rewind to this Checkpoint does, asked in place; files are asked only when some changed. */
const RewindPrompt = (props: { title: string; plan: RewindPlan | null; failure: string | null; rewind: Rewind }) => {
  const [files, setFiles] = createSignal<Files | null>(null);
  const [named, setNamed] = createSignal<ReadonlySet<string>>(new Set());

  const paths = () => (props.plan ? changedPaths(props.plan) : []);
  const chosen = () => (props.plan?.files_changed ? files() : "keep");

  const toggle = (agent: string) =>
    setNamed((now) => {
      const next = new Set(now);

      if (!next.delete(agent)) next.add(agent);

      return next;
    });

  const go = () => {
    const choice = chosen();

    if (choice) props.rewind.run({ files: choice, takeover: [...named()] });
  };

  return (
    <div
      class="thread-rewind"
      data-rewind-prompt
      onKeyDown={(press) => {
        if (press.key === "Escape") props.rewind.close();
      }}
    >
      <p class="thread-rewind-title">rewind to {props.title}?</p>
      <Show when={props.plan}>
        {(plan) => (
          <>
            <ul class="thread-rewind-agents">
              <For each={plan().agents}>
                {(each) => (
                  <li class="thread-rewind-agent" data-rewind-agent={each.agent}>
                    <span>{each.name}</span>{" "}
                    <span class="thread-rewind-state">{each.created_after ? "removed" : each.takeover ? "under takeover" : "back"}</span>
                    <Show when={each.takeover && !each.created_after}>
                      <label class="thread-rewind-choice">
                        <input type="checkbox" checked={named().has(each.agent)} disabled={props.rewind.pending()} onChange={() => toggle(each.agent)} /> rewind it too
                      </label>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <Show when={plan().files_changed}>
              <div class="thread-rewind-files" data-rewind-files>
                <p class="thread-rewind-state">files changed after this</p>
                <ul class="thread-rewind-paths">
                  <For each={paths().slice(0, SHOWN_PATHS)}>{(path) => <li>{path}</li>}</For>
                  <Show when={paths().length > SHOWN_PATHS}>
                    <li class="thread-rewind-state">+{paths().length - SHOWN_PATHS} more</li>
                  </Show>
                </ul>
                <div class="thread-rewind-choices" role="radiogroup" aria-label="files">
                  <label class="thread-rewind-choice">
                    <input type="radio" name="rewind-files" checked={files() === "keep"} disabled={props.rewind.pending()} onChange={() => setFiles("keep")} /> chats only
                  </label>
                  <label class="thread-rewind-choice">
                    <input type="radio" name="rewind-files" checked={files() === "restore"} disabled={props.rewind.pending()} onChange={() => setFiles("restore")} /> chats and files
                  </label>
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.failure}>{(message) => <ErrorLine message={message()} />}</Show>
      <div class="thread-rewind-actions">
        <button data-button="primary" type="button" class="word" disabled={!props.plan || chosen() === null || props.rewind.pending()} onClick={go}>
          rewind
        </button>
        <button
          data-button="quiet"
          type="button"
          class="word"
          disabled={props.rewind.pending()}
          ref={(button) => queueMicrotask(() => button.focus())}
          onClick={() => props.rewind.close()}
        >
          keep
        </button>
      </div>
    </div>
  );
};

/** U355: one Checkpoint: its title, its time, and its Blocks in the Door's order. U374: and the way back to it. */
export const CheckpointCard = (props: { checkpoint: Checkpoint; rewind: Rewind }) => {
  const prompt = () => {
    const now = props.rewind.prompt();

    return now?.checkpoint === props.checkpoint.id ? now : null;
  };

  return (
    <article class="thread-checkpoint" data-checkpoint={props.checkpoint.id}>
      <h3 class="thread-checkpoint-title">
        {props.checkpoint.title} <span class="thread-checkpoint-time">{clock(props.checkpoint.at)}</span>
        <Show when={props.rewind.rewoundTo() === props.checkpoint.id}>
          {" "}
          <span class="thread-checkpoint-rewound" data-rewound>rewound to here</span>
        </Show>
        <Show when={props.rewind.isRewindable(props.checkpoint) && !props.rewind.pending()}>
          {" "}
          <button data-button="quiet" type="button" class="thread-checkpoint-rewind" onClick={() => props.rewind.open(props.checkpoint.id)}>
            rewind
          </button>
        </Show>
      </h3>
      <For each={props.checkpoint.blocks}>{(block) => <BlockView block={block} />}</For>
      <Show when={prompt()}>{(now) => <RewindPrompt title={props.checkpoint.title} plan={now().plan} failure={now().failure} rewind={props.rewind} />}</Show>
    </article>
  );
};
