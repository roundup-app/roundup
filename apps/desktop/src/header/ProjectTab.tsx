import { createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { Icon } from "../ink/Icon";
import { MARKS, markOf, tipOf } from "./tab";
import { nameParts } from "./tab";
import type { StripTab } from "./tab";

/** The field that takes a tab's place (U183): `Enter` saves, `Escape` cancels, a click elsewhere saves; no key in it reaches anything else. */
const RenameField = (props: { name: string; onDone: (saved: string | null, refocus: boolean) => void }) => {
  let field: HTMLInputElement | undefined;
  let finished = false;

  const finish = (saved: string | null, refocus: boolean) => {
    if (finished) return;

    finished = true;
    props.onDone(saved, refocus);
  };

  // Window capture runs before every other listener: a key typed here is never a chord, and never reaches a Terminal.
  const onKey = (press: KeyboardEvent) => {
    if (press.target !== field) return;

    press.stopPropagation();

    if (press.isComposing) return;

    if (press.key === "Enter") {
      press.preventDefault();
      finish(field?.value ?? "", true);
    } else if (press.key === "Escape") {
      press.preventDefault();
      finish(null, true);
    }
  };

  window.addEventListener("keydown", onKey, true);
  onCleanup(() => window.removeEventListener("keydown", onKey, true));

  return (
    <input
      class="tab-rename"
      aria-label="project name"
      value={props.name}
      ref={(element) => {
        field = element;
        queueMicrotask(() => {
          element.focus();
          element.select();
        });
      }}
      onBlur={() => finish(field?.value ?? "", false)}
    />
  );
};

/** One Project tab (U179): its name and one Tab mark, and nothing else until the pointer or focus is on it (U182, U184). */
export const ProjectTab = (props: {
  tab: StripTab;
  selected: boolean;
  onSelect: () => void;
  onMark: () => void;
  onRename: (name: string) => void;
  onClose: () => void;
  ref?: (element: HTMLElement) => void;
}) => {
  const tip = createUniqueId();
  const [pointer, setPointer] = createSignal(false);
  const [focus, setFocus] = createSignal(false);
  const [place, setPlace] = createSignal({ left: 0, top: 0 });
  const [editing, setEditing] = createSignal<number | null>(null);
  let wrap: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;

  const mark = () => markOf(props.tab);
  const near = () => pointer() || focus();

  const edit = () => setEditing(wrap?.offsetWidth ?? 0);

  return (
    <div
      class="project-tab"
      role="presentation"
      data-path={props.tab.path}
      style={editing() === null ? undefined : { width: `${editing()}px` }}
      ref={(element) => {
        wrap = element;
        props.ref?.(element);
      }}
      onPointerEnter={() => {
        const box = wrap?.getBoundingClientRect();

        setPlace({ left: box?.left ?? 0, top: box?.bottom ?? 0 });
        setPointer(true);
      }}
      onPointerLeave={() => setPointer(false)}
      onFocusIn={() => {
        const box = wrap?.getBoundingClientRect();

        setPlace({ left: box?.left ?? 0, top: box?.bottom ?? 0 });
        setFocus(true);
      }}
      onFocusOut={(blur) => {
        if (!(blur.relatedTarget instanceof Node && wrap?.contains(blur.relatedTarget))) setFocus(false);
      }}
    >
      <Show
        when={editing() === null}
        fallback={
          <RenameField
            name={props.tab.name}
            onDone={(saved, refocus) => {
              setEditing(null);

              if (refocus) button?.focus();

              if (saved !== null) props.onRename(saved);
            }}
          />
        }
      >
        <button data-button="quiet"
          type="button"
          role="tab"
          class="tab-name-button"
          aria-selected={props.selected}
          data-selected={props.selected}
          aria-describedby={near() && mark() !== null ? tip : undefined}
          title={props.tab.path}
          ref={(element) => (button = element)}
          onClick={(click) => (click.target instanceof Element && click.target.closest(".tab-mark") ? props.onMark() : props.onSelect())}
          onKeyDown={(press) => {
            if (press.key === "F2" && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey) {
              press.preventDefault();
              edit();
            }
          }}
        >
          <span class="tab-name" onDblClick={edit}>
            <span class="tab-head">{nameParts(props.tab.name)[0]}</span>
            <span class="tab-tail">{nameParts(props.tab.name)[1]}</span>
          </span>
          <Show when={mark()}>
            {(shown) => (
              <span class="tab-mark ink" data-tone={MARKS[shown()].tone} role="img" aria-label={MARKS[shown()].label}>
                {MARKS[shown()].character}
              </span>
            )}
          </Show>
        </button>
        <button data-button="icon" type="button" class="tab-close" aria-label={`close ${props.tab.name}`} data-visible={near()} onClick={() => props.onClose()}>
          <Icon name="x" />
        </button>
      </Show>
      <Show when={near() && mark() !== null}>
        <span class="tab-tip" id={tip} role="tooltip" style={{ left: `${place().left}px`, top: `${place().top}px` }}>
          {tipOf(props.tab)}
        </span>
      </Show>
    </div>
  );
};
