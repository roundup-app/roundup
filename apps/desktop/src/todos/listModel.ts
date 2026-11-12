import { afterElseBefore } from "../keys/survivor";
import type { Todo } from "@contracts/todo/Todo";

const rows = new Map<number, HTMLButtonElement>();

/** The one `ref` callback for a row button: `registered` is the button this owner set before, so a later owner's entry survives its cleanup. */
export const rowRef = (id: number, button: HTMLButtonElement | null, registered?: HTMLButtonElement): void => {
  if (button) rows.set(id, button);
  else if (registered === undefined || rows.get(id) === registered) rows.delete(id);
};

/** The row button a Todo registered, or null once it left. */
export const rowButtonOf = (id: number): HTMLButtonElement | null => rows.get(id) ?? null;

/** The id whose registered row button is `element`. */
export const idOfRow = (element: Element | null): number | undefined => {
  for (const [id, button] of rows) if (button === element) return id;

  return undefined;
};

/** Focus the row a model choice named; false when it is gone or under an inert ancestor such as an open modal. */
export const focusRow = (id: number): boolean => {
  const button = rows.get(id);

  if (!button?.isConnected || button.closest("[hidden], [inert]")) return false;
  button.focus();

  return true;
};

/** The id that takes focus once `id` leaves `order`: the next one, else the previous, else none. */
export const survivorOf = (order: readonly number[], id: number): number | undefined => {
  const survivor = afterElseBefore(order.map(String), String(id), each => each !== String(id));

  return survivor === undefined ? undefined : Number(survivor);
};

/** U3751: the one visible test and the ids of open, visible Todos in the order the view renders. */
export const createListModel = (input: {
  rows: () => readonly { todo: Todo }[];
  visible: (id: number) => boolean;
  closedGroups: () => readonly string[];
  groupOf: (todo: Todo) => string;
}) => {
  const hidden = (todo: Todo) => !input.visible(todo.id) || input.closedGroups().includes(input.groupOf(todo));
  const openOrder = () => input.rows().flatMap(row => !row.todo.done && !hidden(row.todo) ? [row.todo.id] : []);

  return { hidden, openOrder };
};
