import { copy } from "../../copy";
import { createEffect, For, onCleanup, onMount, Show } from "solid-js";
import type { RailMenuModel } from "./model";
import { ModelPair } from "../../models/ModelPair";
import { goesLine, goingNames, staysLine } from "./removal";
import { ROW } from "../rows";

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
      document.querySelectorAll<HTMLElement>(ROW).forEach((row) => {
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
          aria-label={props.menu.stage() === null ? copy.actionsFor(current().node.name) : copy.modelFor(current().node.name)}
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
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseStop}>{copy.stop}</button>
                </Show>
                <Show when={props.menu.canResume(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseResume}>{copy.resume}</button>
                </Show>
                <Show when={props.menu.canModel(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseModel}>{copy.modelMenu}</button>
                </Show>
                <button data-button="quiet" role="menuitem" onClick={props.menu.chooseRemove}>{copy.remove}</button>
                <Show when={props.menu.canClear(current())}>
                  <button data-button="quiet" role="menuitem" onClick={props.menu.chooseClear}>{copy.clearMenu}</button>
                </Show>
              </>
            }
          >
            <Show
              when={current().action !== "stop"}
              fallback={<span class="rail-menu-question">{copy.stopQuestion(current().node.name)}</span>}
            >
            <Show
              when={current().node.kind === "workstream"}
              fallback={<span class="rail-menu-question">{copy.stopAndRemoveQuestion(current().node.name)}</span>}
            >
              <span class="rail-menu-question">{copy.removeQuestion(current().node.name)}</span>
              <Show when={current().removal}>
                {(removal) => (
                  <>
                    <span class="rail-menu-line">{goesLine(removal())}</span>
                    <For each={goingNames(removal())}>{(name) => <span class="rail-menu-line rail-menu-name">{name}</span>}</For>
                    <Show when={staysLine(removal())}>{(line) => <span class="rail-menu-line rail-menu-stay">{line()}</span>}</Show>
                    <For each={removal().stays.agents}>
                      {(stay) => <span class="rail-menu-line rail-menu-name rail-menu-stay">{copy.toastLine(stay.name, stay.reason)}</span>}
                    </For>
                  </>
                )}
              </Show>
            </Show>
            </Show>
            <button data-button="quiet" role="menuitem" onClick={current().action === "stop" ? props.menu.chooseStop : props.menu.chooseRemove}>{current().action === "stop" ? copy.stop : copy.remove}</button>
            <button data-button="quiet" role="menuitem" onClick={closeAndFocusRow}>{copy.keep}</button>
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
                  <button data-button="quiet" type="button" disabled={!props.menu.canApply(current())} onClick={props.menu.apply}>{copy.apply}</button>
                </>
              }>
                <span class="rail-menu-question">
                  {copy.changeToItReReadsItsConversationOn(current().node.name, props.menu.choices.labelOf(props.menu.pair().model))}
                </span>
                <button data-button="quiet" type="button" onClick={props.menu.change}>{copy.change}</button>
                <button data-button="quiet" type="button" data-cancel onClick={closeAndFocusRow}>{copy.cancel}</button>
              </Show>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};
