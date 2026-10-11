import { For, Match, onCleanup, Switch } from "solid-js";
import type { Block } from "@contracts/checkpoint/Block";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import { visualKinds } from "../pads/visualKinds";
import { clock } from "./lines";

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

/** U355: one Checkpoint: its title, its time, and its Blocks in the Door's order. */
export const CheckpointCard = (props: { checkpoint: Checkpoint }) => (
  <article class="thread-checkpoint" data-checkpoint={props.checkpoint.id}>
    <h3 class="thread-checkpoint-title">
      {props.checkpoint.title} <span class="thread-checkpoint-time">{clock(props.checkpoint.at)}</span>
    </h3>
    <For each={props.checkpoint.blocks}>{(block) => <BlockView block={block} />}</For>
  </article>
);
