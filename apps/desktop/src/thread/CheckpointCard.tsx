import { createEffect, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { Block } from "@contracts/checkpoint/Block";
import type { Checkpoint } from "@contracts/checkpoint/Checkpoint";
import { visualKinds } from "../pads/visualKinds";
import { clock } from "./lines";

/** U148's renderer on a Checkpoint's `diagram`; the source shows in a `pre` until it renders and when it fails to. */
const Diagram = (props: { source: string }) => {
  const draw = (host: HTMLDivElement) => {
    createEffect(() => {
      const pre = document.createElement("pre");

      pre.textContent = props.source;
      host.replaceChildren(pre);

      const release = visualKinds().get("mermaid")?.mount(host, { text: props.source, readonly: true, replace: () => {} });

      onCleanup(() => release?.());
    });
  };

  return <div class="checkpoint-diagram" data-block-diagram ref={draw} />;
};

const rowsOf = (block: Block) => (block.kind === "rows" ? block : undefined);

const tableOf = (block: Block) => (block.kind === "table" ? block : undefined);

const diagramOf = (block: Block) => (block.kind === "diagram" ? block : undefined);

const textOf = (block: Block) => (block.kind === "text" ? block : undefined);

/** U355: one Block, drawn by its kind; every string is text. */
const BlockView = (props: { block: Block }) => (
  <section class="checkpoint-block" data-block={props.block.kind}>
    <Show when={props.block.title}>{(title) => <h4 class="checkpoint-block-title">{title()}</h4>}</Show>
    <Switch>
      <Match when={rowsOf(props.block)}>
        {(block) => (
          <dl class="checkpoint-rows">
            <For each={block().rows}>
              {(row) => (
                <>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </>
              )}
            </For>
          </dl>
        )}
      </Match>
      <Match when={tableOf(props.block)}>
        {(block) => (
          <div class="checkpoint-scroll" tabIndex={0}>
            <table class="checkpoint-table">
              <thead>
                <tr>
                  <For each={block().head}>{(cell) => <th scope="col">{cell}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={block().rows}>
                  {(row) => (
                    <tr>
                      <For each={row}>{(cell) => <td>{cell}</td>}</For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        )}
      </Match>
      <Match when={diagramOf(props.block)}>{(block) => <Diagram source={block().mermaid} />}</Match>
      <Match when={textOf(props.block)}>{(block) => <p class="checkpoint-text">{block().text}</p>}</Match>
    </Switch>
  </section>
);

/** U355: a Checkpoint is a card: its title and time over the Door's Blocks in the Door's order. */
export const CheckpointCard = (props: { checkpoint: Checkpoint }) => (
  <article class="checkpoint" data-checkpoint={props.checkpoint.id}>
    <header class="checkpoint-head">
      <h3 class="checkpoint-title">{props.checkpoint.title}</h3>
      <time class="checkpoint-time">{clock(props.checkpoint.at)}</time>
    </header>
    <For each={props.checkpoint.blocks}>{(block) => <BlockView block={block} />}</For>
  </article>
);
