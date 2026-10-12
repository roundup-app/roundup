import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../ink/Icon";

export type MoreItem = { icon: Parameters<typeof Icon>[0]["name"]; label: string; run: () => void };

/** U422: the `⋯` button and its menu; each item is an icon and its label. */
export const MoreMenu = (props: { items: readonly MoreItem[] }) => {
  const [open, setOpen] = createSignal(false);
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [button, setButton] = createSignal<HTMLButtonElement>();

  onMount(() => {
    const dismiss = (press: PointerEvent) => {
      if (press.target instanceof Node && root()?.contains(press.target) === false) setOpen(false);
    };

    document.addEventListener("pointerdown", dismiss);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss));
  });

  const items = () => [...(root()?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];

  const close = () => {
    setOpen(false);
    button()?.focus();
  };

  const onKeyDown = (press: KeyboardEvent) => {
    if (!open()) return;

    if (press.key === "Escape") {
      press.preventDefault();
      close();

      return;
    }

    const all = items();
    const at = all.findIndex((item) => item === document.activeElement);

    if (press.key === "ArrowDown" || press.key === "ArrowUp") {
      press.preventDefault();
      all[(Math.max(at, 0) + (press.key === "ArrowDown" ? (at < 0 ? 0 : 1) : all.length - 1)) % all.length]?.focus();
    }
  };

  return (
    <div class="thread-more-menu" ref={setRoot} onKeyDown={onKeyDown}>
      <button
        ref={setButton}
        data-button="icon"
        type="button"
        class="word"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => {
          setOpen((now) => !now);
          queueMicrotask(() => items()[0]?.focus());
        }}
      >
        <Icon name="more" />
      </button>
      <Show when={open()}>
        <div class="thread-menu" role="menu" aria-label="More">
          <For each={props.items}>
            {(item) => (
              <button
                data-button="quiet"
                type="button"
                class="word"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
