import { afterEach, expect, it, vi } from "vitest";
import { createFrameRun } from "./frame_run";
import { createKeystrokeRun } from "./run";
import type { AppSeam } from "../app/seam";

vi.mock("../terminal/emulator", () => ({ createXtermEmulators: () => () => ({ write: (_: Uint8Array, parsed?: () => void) => parsed?.() }) }));

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

it.each(["keys", "frames"])("r3841a_terminal_setup_waits_for_agent_before_opening_shell (%s)", async (kind) => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button>Add</button>';
  const button = document.querySelector("button")!;
  button.setAttribute("aria-label", "Add Workstream");
  button.onclick = () => document.body.insertAdjacentHTML("beforeend", '<div role="treeitem" aria-selected="true"></div>');
  const rpc = vi.fn().mockResolvedValue({ from: 0, next: 6, text: "ready\n", truncated: false });
  const app = { rpc } as unknown as AppSeam;
  const run = kind === "keys" ? createKeystrokeRun(app) : createFrameRun(app, "unknown", "/tmp");
  let opens = 0;
  const open = (event: KeyboardEvent) => {
    if (event.key !== "t") return;
    opens += 1;
    document.body.insertAdjacentHTML("beforeend", '<div class="bubble" data-bubble="shell"><textarea class="xterm-helper-textarea"></textarea></div>');
    run.createEmulator("shell").write(new TextEncoder().encode("ready\n"));
  };
  document.addEventListener("keydown", open);
  const done = run.start();
  // Drains the selected-row/MutationObserver promises without advancing the setup bound.
  await vi.advanceTimersByTimeAsync(0);
  expect(opens).toBe(0);
  document.body.insertAdjacentHTML("beforeend", '<textarea class="xterm-helper-textarea"></textarea>');
  await vi.advanceTimersByTimeAsync(0);
  expect(opens).toBe(1);
  expect(document.activeElement?.closest<HTMLElement>("[data-bubble]")?.dataset.bubble).toBe("shell");
  await vi.advanceTimersByTimeAsync(10_000);
  await done;
  expect(rpc.mock.calls.filter(([method]) => method === "terminal.write").every(([, params]) => params.id === "shell")).toBe(true);
  document.removeEventListener("keydown", open);
});
