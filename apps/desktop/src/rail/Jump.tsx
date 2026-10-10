import { createEffect, on, onCleanup } from "solid-js";
import { useConnectedProject } from "../state/connectedProject";

/** `⌥1` to `⌥9` by key position: ⌥ makes another character on a Mac, so the character is never read. */
const digitOf = (press: KeyboardEvent): number | null => {
  const found = /^Digit([0-9])$/.exec(press.code);

  return found ? Number(found[1]) : null;
};

/** The ids of the Agent rows the Rail shows, top to bottom: a Door's row (its Workstream's) counts, a Terminal's does not, and a collapsed Workstream's Agents are not in the DOM. */
const shownAgentIds = (kinds: ReadonlyMap<string, string>): string[] =>
  [...document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"][data-id]')].flatMap((row) => {
    const id = row.dataset.id ?? "";

    return kinds.get(id) === "agent" || kinds.get(id) === "workstream" ? [id] : [];
  });

const focusPane = (): void => document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus();

const focusThread = (): void => document.querySelector<HTMLElement>("[data-thread-input]")?.focus();

/** U107: `⌥1` to `⌥9` select the n-th Agent row and begin a Takeover of it; `⌥0` ends it (U187 shows the Door's Terminal only in one). No UI of its own; `onFailure` gets the message of a failed call, and `null` when the next jump starts. */
export const Jump = (props: { onFailure: (message: string | null) => void }) => {
  const { rail, takeover } = useConnectedProject();

  // U187: selecting another row ends the Takeover first.
  createEffect(
    on(rail.selected, (id) => {
      const taken = takeover.taken();

      if (taken !== null && taken !== id) void takeover.end(taken).then((failure) => failure !== null && props.onFailure(failure));
    }),
  );

  const jump = async (agent: string): Promise<void> => {
    const failure = await takeover.begin(agent);

    if (failure !== null) props.onFailure(failure);
    else focusPane();
  };

  const onKey = (press: KeyboardEvent): void => {
    if (!press.altKey || press.metaKey || press.ctrlKey || press.shiftKey) return;

    const digit = digitOf(press);

    if (digit === null) return;

    if (digit === 0) {
      press.preventDefault();
      press.stopPropagation();
      focusThread();
      void takeover.end().then((failure) => {
        if (failure !== null) props.onFailure(failure);

        focusThread();
      });

      return;
    }

    const kinds = new Map(rail.nodes.map((node) => [node.id, node.kind]));
    const target = shownAgentIds(kinds)[digit - 1];

    if (target === undefined) return;

    press.preventDefault();
    press.stopPropagation();
    props.onFailure(null);
    rail.select(target);
    focusPane();
    void jump(target);
  };

  // Capture, and before the Pane or xterm sees it: the chord is the webview's wherever focus is (it narrows U12).
  document.addEventListener("keydown", onKey, true);
  onCleanup(() => document.removeEventListener("keydown", onKey, true));

  return null;
};
