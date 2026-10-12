import { createEffect, For, onCleanup, onMount, Show } from "solid-js";
import type { RailMenuModel } from "./model";
import { ModelPair } from "../../models/ModelPair";
import { goesLine, goingNames, staysLine } from "./removal";

export const RailMenu = (props: { menu: RailMenuModel }) => {
  let element: HTMLDivElement | undefined;

  onMount(() => {
    const dismiss = (press: PointerEvent) => {
      if (element && press.target instanceof Node && !element.contains(press.target)) props.menu.close();
    };

    document.addEventListener("pointerdown", dismiss);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss));
  });

  createEffect(() => {
    const current = props.menu.state();

    const stage = props.menu.stage();

    if (!current) return;

    queueMicrotask(() => {
      const target = stage === "confirming" ? "[data-cancel]" : stage === "picking" ? "select" : "[role=menuitem]";

      element?.querySelector<HTMLElement>(target)?.focus();
    });
  });

  const closeAndFocusRow = () => {
    const id = props.menu.state()?.node.id;

    props.menu.close();
    queueMicrotask(() => {
      document.querySelectorAll<HTMLElement>("[role=treeitem]").forEach((row) => {
        if (row.dataset.id === id) row.focus();
      });
    });
  };

  const onKeyDown = (press: KeyboardEvent) => {
    if (press.key === "Escape") {
      press.preventDefault();
      closeAndFocusRow();

      return;
    }

    // A select keeps its own arrow keys and `Enter`; the menu's walk is for its items.
    if (props.menu.stage() !== null) return;

    const items = [...(element?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);

    if (press.key === "ArrowDown" || press.key === "ArrowUp") {
      press.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, index + (press.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (press.key === "Enter") {
      press.preventDefault();
      items[Math.max(0, index)]?.click();
    }
  };

  return (
    <Show when={props.menu.state()}>
      {(current) => (
        <div
          ref={(node) => { element = node; }}
          class="rail-menu"
          role={props.menu.stage() === null ? "menu" : "dialog"}
          aria-label={props.menu.stage() === null ? `actions for ${current().node.name}` : `model for ${current().node.name}`}
          style={{ left: `${current().x}px`, top: `${current().y}px` }}
          onKeyDown={onKeyDown}
          onPointerDown={(press) => press.stopPropagation()}
        >
          <Show when={props.menu.stage()} fallback={
          <Show
            when={current().confirming}
            fallback={
              <>
                <Show when={props.menu.canStop(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseStop}>stop</button>
                </Show>
                <Show when={props.menu.canResume(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseResume}>resume</button>
                </Show>
                <Show when={props.menu.canModel(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseModel}>model…</button>
                </Show>
                <button data-button="quiet" role="menuitem" onClick={props.menu.chooseRemove}>remove</button>
                <Show when={props.menu.canClear(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseClear}>clear…</button>
                </Show>
              </>
            }
          >
            <Show
              when={current().node.kind === "workstream"}
              fallback={<span class="rail-menu-question">{current().stopping ? `stop ${current().node.name}?` : `stop and remove ${current().node.name}?`}</span>}
            >
              <span class="rail-menu-question">{`remove ${current().node.name}?`}</span>
              <Show when={current().removal}>
                {(removal) => (
                  <>
                    <span class="rail-menu-line">{goesLine(removal())}</span>
                    <For each={goingNames(removal())}>{(name) => <span class="rail-menu-line rail-menu-name">{name}</span>}</For>
                    <Show when={staysLine(removal())}>{(line) => <span class="rail-menu-line">{line()}</span>}</Show>
                    <For each={removal().stays.agents}>
                      {(stay) => <span class="rail-menu-line rail-menu-name">{`${stay.name}: ${stay.reason}`}</span>}
                    </For>
                  </>
                )}
              </Show>
            </Show>
            <button data-button="quiet" role="menuitem" onClick={current().stopping ? props.menu.chooseStop : props.menu.chooseRemove}>{current().stopping ? "stop" : "remove"}</button>
            <button data-button="quiet" role="menuitem" onClick={closeAndFocusRow}>keep</button>
          </Show>
          }>
            {(stage) => (
              <Show when={stage() === "confirming"} fallback={
                <>
                  <Show when={props.menu.choices.list()}>
                    {(list) => (
                      <ModelPair
                        subject={current().node.name}
                        models={list().models}
                        efforts={list().efforts}
                        model={props.menu.pair().model}
                        effort={props.menu.pair().effort}
                        onModel={(model) => props.menu.setPair({ ...props.menu.pair(), model })}
                        onEffort={(effort) => props.menu.setPair({ ...props.menu.pair(), effort })}
                      />
                    )}
                  </Show>
                  <Show when={props.menu.choices.failure()}>{(message) => <span class="rail-menu-question">{message()}</span>}</Show>
                  <button data-button="quiet" type="button" disabled={!props.menu.canApply(current())} onClick={props.menu.apply}>apply</button>
                </>
              }>
                <span class="rail-menu-question">
                  {`Change ${current().node.name} to ${props.menu.choices.labelOf(props.menu.pair().model)}? It re-reads its conversation on the new Model, which spends more of your usage than a normal turn.`}
                </span>
                <button data-button="quiet" type="button" onClick={props.menu.change}>change</button>
                <button data-button="quiet" type="button" data-cancel onClick={closeAndFocusRow}>cancel</button>
              </Show>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};
