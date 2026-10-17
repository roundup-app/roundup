import { registerKeys } from "../keys/registry";
import { chordsFor } from "../keys/chords";
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

/** U107: `⌥1` to `⌥9` select the n-th Agent row, focus its Terminal and begin a Takeover of it unless it is a Door (U467: the Door is always typed into); `⌥0` ends the Takeover. No UI of its own; `onFailure` gets the message of a failed call, and `null` when the next jump starts. */
export const Jump = (props: { onFailure: (message: string | null) => void }) => {
  const { rail, takeover } = useConnectedProject();

  const jump = async (agent: string): Promise<void> => {
    if (rail.nodes.find((node) => node.id === agent)?.kind === "workstream") return;

    const failure = await takeover.begin(agent);

    if (failure !== null) props.onFailure(failure);
    else focusPane();
  };

  const agentAt = (press: KeyboardEvent): string | undefined => {
    const kinds = new Map(rail.nodes.map((node) => [node.id, node.kind]));

    return shownAgentIds(kinds)[(digitOf(press) ?? 0) - 1];
  };

  // The chord is the webview's wherever focus is (it narrows U12): the registry sees it before the Pane or xterm does.
  registerKeys({ kind: "app" }, [
    {
      chords: chordsFor("⌥0"),
      run: () => {
        focusPane();
        void takeover.end().then((failure) => {
          if (failure !== null) props.onFailure(failure);

          focusPane();
        });
      },
    },
    {
      chords: chordsFor("⌥1–⌥9"),
      when: (press) => agentAt(press) !== undefined,
      run: (press) => {
        const target = agentAt(press);

        if (target === undefined) return;

        props.onFailure(null);
        rail.select(target);
        focusPane();
        void jump(target);
      },
    },
  ]);

  return null;
};
