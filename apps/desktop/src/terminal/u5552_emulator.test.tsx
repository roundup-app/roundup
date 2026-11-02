import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectedProjectContext } from "../state/connectedProject";
import { pasteEvent } from "../testing/clipboard";
import { Bubble } from "../bubbles/Bubble";
import { info, terminal, node, door } from "../testing/nodes";
import { callsTo, connectFakeProject } from "./paneHarness";
import { createXtermEmulators } from "./emulator";
import type { Screens } from "./screens";
import { Pane } from "./Pane";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const mount = async (kind = "shell") => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  const { app, connected } = await connectFakeProject([kind === "agent" ? node("a") : kind === "door" ? door("a") : terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  const real = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }));
  const emulators = new Map<string, ReturnType<typeof real>>();
  let screens!: Screens;

  const { container } = render(() => <ConnectedProjectContext.Provider value={connected}>
    <Pane screensRef={value => { screens = value; }} createEmulator={(id, copy) => { const made = real(id, copy); emulators.set(id, made);

 return made; }} />
  </ConnectedProjectContext.Provider>);

  connected.rail.select("b");
  connected.rail.select("a");
  const input = () => container.querySelector<HTMLTextAreaElement>(".pane-screen textarea")!;
  const field = document.createElement("textarea");
  container.append(field);
  await new Promise<void>(resolve => emulators.get("t-a")!.write(new TextEncoder().encode("\x1b[?2004h"), resolve));
  input().focus();

  return { app, connected, emulators, container, input, field, screens };
};

it.each(["text", "image"].flatMap(kind => ["same", "terminal", "field", "away-and-back"].map(focus => ({ kind, focus }))))(
  "u5552d_paste_keeps_focus_owner $kind $focus", async ({ kind, focus }) => {
    const { app, connected, input, field, emulators, screens } = await mount();
    const save = Promise.withResolvers<string>();

    const saveImage = vi.spyOn(connected.app, "savePastedImage").mockImplementation(async image => { app.savedImages.push(image);

 return save.promise; });

    const decode = Promise.withResolvers<ArrayBuffer>();
    const file = new File([Uint8Array.of(137, 80, 78, 71)], "image", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: () => decode.promise });
    pasteEvent(input(), kind === "text" ? "one\ntwo 界" : "", kind === "image" ? [file] : []);

    if (kind === "image") {
      decode.resolve(Uint8Array.of(137, 80, 78, 71).buffer);
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledOnce());
    }

    if (focus === "terminal" || focus === "away-and-back") connected.rail.select("b");

    if (focus === "field") field.focus();

    if (focus === "away-and-back") connected.rail.select("a");
    const active = document.activeElement;
    save.resolve("/tmp/pasted.png");

    if (focus === "same") {
      await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: btoa(kind === "text" ? String.fromCharCode(...new TextEncoder().encode("\x1b[200~one\rtwo 界\x1b[201~")) : "\x1b[200~'/tmp/pasted.png' \x1b[201~") }]));
    } else {
      await vi.waitFor(() => expect(screens.failure("t-a")).toContain("focus changed"));
      expect(callsTo(app, "terminal.write")).toEqual([]);
      expect(document.activeElement).toBe(active);
      connected.rail.select("a");
      await new Promise<void>(resolve => emulators.get("t-a")!.write(new Uint8Array(), resolve));
      expect(callsTo(app, "terminal.write")).toEqual([]);
    }

    expect(app.savedImages).toHaveLength(kind === "image" ? 1 : 0);
  },
);

it.each(["key", "composition"])("u5552c_keys_and_composition_follow_focus %s", async kind => {
  const { app, connected, input, field } = await mount();
  const former = input();

  const enter = (target: HTMLTextAreaElement) => {
    if (kind === "key") fireEvent.keyDown(target, { key: "Enter", keyCode: 13 });
    else {
      fireEvent.compositionStart(target);
      target.value = "界";
      fireEvent.compositionUpdate(target, { data: "界" });
      fireEvent.compositionEnd(target, { data: "界" });
    }
  };

  if (kind === "composition") {
    fireEvent.compositionStart(former);
    former.value = "old";
    fireEvent.compositionUpdate(former, { data: "old" });
  }

  connected.rail.select("b");

  if (kind === "composition") fireEvent.compositionEnd(former, { data: "old" });
  enter(input());
  await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-b", data: kind === "key" ? "DQ==" : "55WM" }]));
  field.focus();
  enter(former);
  expect(callsTo(app, "terminal.write")).toHaveLength(1);
});

it.each(["field", "terminal", "covered", "hidden", "outside"])("u5552e_drop_focuses_only_its_destination %s", async origin => {
  const { app, screens, container, input, field } = await mount();
  const body = container.querySelector<HTMLElement>(".pane-body")!;
  body.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);

  if (origin === "terminal") {
    const other = document.createElement("div");
    container.append(other);
    screens.show("t-b", other);
  }
  else field.focus();
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => origin === "hidden" ? null : origin === "covered" ? field : body });
  const active = document.activeElement;
  const focused: boolean[] = [];
  app.handlers["terminal.write"] = () => { focused.push(document.activeElement === input());

 return null; };

  app.dropFiles({ phase: "drop", x: origin === "outside" ? 200 : 50, y: 50, paths: ["/tmp/it's.png"] });

  if (origin === "covered" || origin === "hidden" || origin === "outside") {
    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(document.activeElement).toBe(active);
  } else {
    expect(focused).toEqual([true]);
    expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: btoa("\x1b[200~'/tmp/it'\\''s.png' \x1b[201~") }]);
  }

  Reflect.deleteProperty(document, "elementFromPoint");
});

it("u5552b_background_protocol_replies_keep_their_terminal", async () => {
  const { app, emulators, field } = await mount();
  field.focus();
  await new Promise<void>(resolve => emulators.get("t-a")!.write(new TextEncoder().encode("\x1b[5n"), resolve));
  expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: btoa("\x1b[0n") }]);
});


it("u5552d_focus_move_during_image_decoding_prevents_even_the_save", async () => {
  const { app, connected, input, screens } = await mount();
  const decode = Promise.withResolvers<ArrayBuffer>();
  const file = new File(["image"], "image.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: () => decode.promise });
  pasteEvent(input(), "", [file]);
  connected.rail.select("b");
  decode.resolve(new ArrayBuffer(4));
  await vi.waitFor(() => expect(screens.failure("t-a")).toContain("focus changed"));
  expect(app.savedImages).toEqual([]);
  expect(callsTo(app, "terminal.write")).toEqual([]);
});

it.each(["agent", "door", "bubble"])("u5552d_text_and_image_use_the_focused_emulator %s", async kind => {
  const { app, connected, screens, input } = await mount(kind);

  if (kind === "bubble") render(() => <Bubble id="t-a" screens={screens} name="Shell" place={{ x: 0, y: 0, w: 600, h: 400, min: false }} origin={{ left: 0, top: 0 }} extent={() => ({ width: 800, height: 600 })} setPlace={() => {}} readOnly={() => false} close={async () => {}} menu={() => {}} toggleMinimised={() => {}} />);
  const target = kind === "bubble" ? document.querySelector<HTMLTextAreaElement>(".bubble textarea")! : input();
  target.focus();
  pasteEvent(target, "hello");
  await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toHaveLength(1));
  vi.spyOn(connected.app, "savePastedImage").mockResolvedValue("/tmp/image.png");
  const file = new File(["image"], "image.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
  pasteEvent(target, "", [file]);
  await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([
    { id: "t-a", data: btoa("\x1b[200~hello\x1b[201~") },
    { id: "t-a", data: btoa("\x1b[200~'/tmp/image.png' \x1b[201~") },
  ]));
});
