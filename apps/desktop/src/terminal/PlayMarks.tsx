import { createMemo, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { createMessageToast } from "../ink/messageToast";
import { PlayMark } from "../ui/PlayMark";
import type { ConnectedProject } from "../state/connectedProject";
import type { RailNode } from "@contracts/agent/RailNode";
import { doorTerminalId } from "../state/doorNode";
import type { Screens } from "./screens";
import type { Emulator } from "./emulator";
import type { PlayLine } from "./playLines";
import { copy } from "./copy";

/** The Daemon is asked again for an Agent's printed commands at most this often while its screen changes. */
const REFRESH_MS = 2000;

/**
 * U7889: a ▶ beside each screen line of an Agent's Terminal that equals a shell command the Agent printed (U7889a); it shows
 * while the pointer is over the line or the button has focus. A click runs the command in a shell the Agent owns (U7889b, c)
 * and shows that shell's Bubble (U7889d). Nothing is typed into the Agent's own Terminal.
 */
export const PlayMarks = (props: { connected: ConnectedProject; agent: string; emulator: Emulator; host: HTMLElement; rowHeight: () => number }) => {
  // The parent keys this component by Agent and Terminal, so these props never change while it lives.
  const { connected, agent, emulator, host } = untrack(() => props);
  const { app, rail } = connected;
  const [printed, setPrinted] = createSignal<readonly string[]>([]);
  const [lines, setLines] = createSignal<PlayLine[]>([], { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const [hover, setHover] = createSignal<number | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  let lastAsk = 0;
  let asking = false;

  const refresh = (): void => {
    setLines(emulator.playLines?.(printed()) ?? []);
  };

  const ask = async (): Promise<void> => {
    if (asking) return;

    asking = true;
    lastAsk = Date.now();

    try {
      setPrinted((await app.rpc("agent.printedCommands", { id: agent })).commands);
    } catch {
      // The record may not exist yet: no ▶ shows until it does.
    } finally {
      asking = false;
    }

    refresh();
  };

  const framed = (): void => {
    refresh();

    if (Date.now() - lastAsk >= REFRESH_MS) void ask();
  };

  onSettled(() => {
    void ask();
    emulator.onFrame?.(framed);
  });

  makeEventListener(host, "mousemove", (move) => {
    const height = props.rowHeight();

    setHover(height > 0 ? Math.floor((move.clientY - host.getBoundingClientRect().top) / height) : null);
  });
  makeEventListener(host, "mouseleave", () => setHover(null));
  onCleanup(() => setHover(null));

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null) });

  const run = async (command: string): Promise<void> => {
    try {
      const opened = await app.rpc("agent.runPrinted", { id: agent, command });

      setFailure(null);
      rail.revealTerminal?.(opened.terminal_id);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };

  return (
    <div class="play-marks" style={{ "--play-row-height": `${props.rowHeight()}px` }}>
      <For each={lines()}>{(line) => (
        <PlayMark
          name={copy.runPrinted(line.command)}
          row={line.row}
          span={line.span}
          shown={covers(hover(), line.row, line.span)}
          run={() => void run(line.command)}
        />
      )}</For>
    </div>
  );
};

const covers = (at: number | null, row: number, span: number): boolean => at !== null && at >= row && at < row + span;

/** U7889: shows the marks of the selected Agent's Terminal; they live and die with that selection, not with each refreshed row. */
export const PlayMarksHost = (props: { connected: ConnectedProject; selected: () => RailNode | null; screens: Screens; screen: () => HTMLElement | undefined }) => {
  const key = createMemo(() => {
    const node = props.selected();
    const terminal = doorTerminalId(node);

    return node?.kind === "agent" && terminal !== null && props.screen() !== undefined ? `${node.id}\n${terminal}` : null;
  });

  return (
    <Show when={key()} keyed>
      {(pair) => {
        const [agent = "", terminal = ""] = pair.split("\n");
        const host = props.screen();

        return host ? <PlayMarks connected={props.connected} agent={agent} emulator={props.screens.emulatorFor(terminal)} host={host} rowHeight={() => props.screens.rows(terminal)?.height ?? 0} /> : null;
      }}
    </Show>
  );
};
