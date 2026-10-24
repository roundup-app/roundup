import { pasteEvent, imageFile } from "../testing/clipboard";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { ConnectedProjectContext } from "../state/connectedProject";
import { info, terminal } from "../testing/nodes";
import { createXtermEmulators } from "./emulator";
import { Pane } from "./Pane";
import { callsTo, connectFakeProject, mountPane } from "./paneHarness";

const PATH = "/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png";

const QUOTED = `'${PATH}' `;

const BYTES = Uint8Array.of(137, 80, 78, 71);

const clipboard = (files: File[], text = "") => ({ files, text });

let current = clipboard([]);

const image = (type: string) => imageFile(type);

const press = (target: Element, options: Record<string, boolean> = { metaKey: true }, key = "v") => {
  if (options.metaKey && !options.shiftKey && !options.altKey && key === "v") pasteEvent(target, current.text, current.files);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("u418 command v with an image pastes the saved file's path", () => {
  it("u418_a_pasted_image_pastes_its_saved_path", async () => {
    current = clipboard([image("image/png")]);
    const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    press(container.querySelector("[data-terminal]")!);

    await vi.waitFor(() => expect(emulators.get("t-a")!.pasted).toEqual([QUOTED]));
    expect(app.savedImages).toHaveLength(1);
    expect(app.savedImages[0]!.type).toBe("image/png");
    expect([...app.savedImages[0]!.bytes]).toEqual([...BYTES]);
    expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: btoa(QUOTED) }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("u418_text_wins_over_an_image", async () => {
    current = clipboard([image("image/png")], "words");
    const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    press(container.querySelector("[data-terminal]")!);

    await vi.waitFor(() => expect(emulators.get("t-a")!.pasted).toEqual(["words"]));
    expect(app.savedImages).toEqual([]);
  });

  it("u418_a_failed_save_shows_its_message_and_writes_nothing", async () => {
    current = clipboard([image("image/png")]);
    const { app, connected, emulators, container } = await mountPane([terminal("a")], [info("t-a")]);

    app.saveImageFailure = new RpcError(-32002, "the image is 30 MiB, over the 20 MiB a paste can save");
    connected.rail.select("a");
    press(container.querySelector("[data-terminal]")!);

    expect((await screen.findByRole("alert")).textContent).toContain("Paste failed: the image is 30 MiB, over the 20 MiB a paste can save");
    expect(emulators.get("t-a")!.pasted).toEqual([]);
    expect(callsTo(app, "terminal.write")).toEqual([]);
  });

  it("u418_an_unsupported_image_type_keeps_the_u349_line", async () => {
    current = clipboard([image("image/bmp")]);
    const { app, connected, container } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    press(container.querySelector("[data-terminal]")!);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Paste failed: The clipboard holds an image, which a Terminal cannot take as text. Save it as a file and drop the file on the pane.",
    );
    expect(app.savedImages).toEqual([]);
  });

  it("u418_a_success_clears_the_notice", async () => {
    current = clipboard([image("image/bmp")]);
    const { connected, container, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    const target = container.querySelector("[data-terminal]")!;

    press(target);
    await screen.findByRole("alert");

    current.files = [image("image/webp")];
    press(target);
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(emulators.get("t-a")!.pasted).toEqual([QUOTED]);
  });

  it("u418_an_exited_terminal_saves_nothing", async () => {
    current = clipboard([image("image/png")]);
    const { app, connected, container } = await mountPane([terminal("a")], [info("t-a", { running: false, exit_code: 0 })]);

    connected.rail.select("a");
    press(container.querySelector("[data-terminal]")!);
    await settle();

    expect(app.savedImages).toEqual([]);
    expect(callsTo(app, "terminal.write")).toEqual([]);
  });

  it("u418_the_state_after_daemon_exited_saves_nothing", async () => {
    current = clipboard([image("image/png")]);
    const [exit, setExit] = createSignal<{ code: number | null } | null>(null);
    const { app, connected, container } = await mountPane([terminal("a")], [info("t-a")], 0, exit);

    connected.rail.select("a");
    setExit({ code: 1 });
    press(container.querySelector("[data-terminal]")!);
    await settle();

    expect(app.savedImages).toEqual([]);
  });


});

it("u418_a_pasted_image_writes_one_bracketed_paste", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  current = clipboard([image("image/png")]);
  const { app, connected } = await connectFakeProject([terminal("a")], [info("t-a")]);
  const emulators = new Map<string, ReturnType<ReturnType<typeof createXtermEmulators>>>();

  const real = createXtermEmulators(undefined, () => ({
    activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; },
  }));

  const { container } = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Pane createEmulator={(id) => {
        const made = real(id);

        emulators.set(id, made);

        return made;
      }} />
    </ConnectedProjectContext.Provider>
  ));

  connected.rail.select("a");
  container.querySelector<HTMLElement>(".pane-body")!.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  await vi.waitFor(() => expect(emulators.get("t-a")).toBeDefined());

  const input: string[] = [];

  emulators.get("t-a")!.onInput((bytes) => input.push(new TextDecoder().decode(bytes)));
  await new Promise<void>((resolve) => emulators.get("t-a")!.write(new TextEncoder().encode("\x1b[?2004h"), resolve));

  press(container.querySelector(".pane-screen")!);
  await vi.waitFor(() => expect(callsTo(app, "terminal.write").length).toBeGreaterThan(0));
  await settle();

  expect(input.join("")).toBe(`\x1b[200~${QUOTED}\x1b[201~`);
  expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: btoa(`\x1b[200~${QUOTED}\x1b[201~`) }]);
});
