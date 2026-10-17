import { Accessibility, Cursor, Feedback, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { effect } from "@dnd-kit/state";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable } from "@dnd-kit/dom/sortable";
import { useSortable, type UseSortableInput } from "@dnd-kit/solid/sortable";
import { mergeProps, onCleanup, splitProps, type JSX } from "solid-js";

/** A press that moves less than this is a click. */
const PRESS_DRAG_PX = 4;

/** A drop target outside the list; `element` carries `data-drop` while the pointer is over it. */
type ExternalTarget = { element: HTMLElement };

type External<T extends ExternalTarget> = {
  /** The target under the pointer for a dragged row, else null. */
  target: (id: string, x: number, y: number) => T | null;
  onDropOutside: (id: string, target: T) => void;
};

type RootProps<T extends ExternalTarget> = JSX.HTMLAttributes<HTMLDivElement> & {
  ids: readonly string[];
  onOrderChange: (ids: string[]) => void;
  external?: External<T> | undefined;
  /** The handles are buttons that keep their own meaning: the library adds no live region and no `aria-pressed`, `aria-grabbed`, `aria-disabled`, role description or description to them, and the list draws no box or radius around a moved row. */
  plain?: boolean;
};

const Root = <T extends ExternalTarget>(props: RootProps<T>) => {
  const [local, rest] = splitProps(props, ["ids", "onOrderChange", "external", "plain", "children"]);
  let over: T | null = null;

  const mark = (next: T | null) => {
    if (next?.element !== over?.element) {
      over?.element.removeAttribute("data-drop");
      next?.element.setAttribute("data-drop", "");
    }

    over = next;
  };

  let stopRestoringFocus: (() => void) | undefined;

  onCleanup(() => { stopRestoringFocus?.(); mark(null); });

  return <DragDropProvider plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor && !(local.plain && plugin === Accessibility)).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragMove={(event) => {
    const { source, position } = event.operation;

    if (!local.external || !source) return;
    // The library dispatches dragmove before it applies the move, so the destination is `to`, else the current position plus `by`.
    const x = event.to?.x ?? position.current.x + (event.by?.x ?? 0);
    const y = event.to?.y ?? position.current.y + (event.by?.y ?? 0);

    mark(local.external.target(String(source.id), x, y));
  }} onDragEnd={(event) => {
    const source = event.operation.source;
    const outside = over;

    mark(null);

    const handle = source?.handle;

    if (source && handle instanceof HTMLElement) {
      stopRestoringFocus?.();
      stopRestoringFocus = effect(() => {
        if (source.status !== "idle") return;
        // Idle precedes the library replacing its placeholder; focus after that replacement.
        queueMicrotask(() => {
          stopRestoringFocus?.();

          if (handle.isConnected) handle.focus();
        });
      });
    }

    if (event.canceled) return;

    if (outside && source && local.external) {
      local.external.onDropOutside(String(source.id), outside);

      return;
    }

    if (!isSortable(source) || source.initialIndex === source.index) return;
    const order = [...local.ids];
    const [moved] = order.splice(source.initialIndex, 1);

    if (moved === undefined) return;
    order.splice(source.index, 0, moved);
    local.onOrderChange(order);
  }}><div {...rest} data-plain={local.plain ? "" : undefined}>{local.children}</div></DragDropProvider>;
};

type ItemProps = Pick<UseSortableInput, "id" | "index" | "disabled"> & {
  /** The handle is also a button: a pointer drag starts after 4 px, so a click stays a click, and Space and Enter stay the button's own. */
  pressable?: boolean;
  children: (parts: ReturnType<typeof useSortable>) => JSX.Element;
};

const Item = (props: ItemProps) => {
  const sortable = useSortable(props.pressable ? mergeProps(props, { sensors: [PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: PRESS_DRAG_PX })] })] }) : props);

  return props.children(sortable);
};

export const Sortable = { Root, Item };
