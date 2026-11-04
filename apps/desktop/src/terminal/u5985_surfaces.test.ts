import * as imageModule from "@xterm/addon-image";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { renderMarkdown } from "../plain/renderMarkdown";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ESC = "\x1b";

// An 8x8 PNG header; jsdom decodes no image, so the stub reads the size from it.
const PNG = (() => {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(16, 8);
  view.setUint32(20, 8);

  return btoa(String.fromCharCode(...bytes));
})();

let modules: [typeof import("./paneHarness"), typeof import("../testing/nodes"), typeof import("./screens"), typeof import("./lazyEmulator")];

beforeAll(async () => {
  modules = await Promise.all([import("./paneHarness"), import("../testing/nodes"), import("./screens"), import("./lazyEmulator")]);
}, 60_000);

/** The Terminal the Screens give a Door or a Bubble (`emulatorFor`) draws a Kitty image sequence. */
const drawsThroughScreens = async (id: string) => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 8, height: 8, close() {} }));
  const addons = vi.spyOn(imageModule, "ImageAddon");
  const [{ connectFakeProject }, { terminal, info }, { createScreens }, { lazyXtermEmulators }] = modules;
  const { connected } = await connectFakeProject([terminal("a")], [info("t-a")]);
  const emulator = createScreens(connected, lazyXtermEmulators()).emulatorFor(id);

  await emulator.ready;
  await new Promise<void>(resolve => emulator.write(new TextEncoder().encode(`${ESC}_Gi=7,a=T,f=100;${PNG}${ESC}\\`), resolve));
  await new Promise(resolve => setTimeout(resolve, 100));

  return addons.mock.instances.at(-1)!.getImageAtBufferCell(0, 0);
};

it("u5985_the_door_terminal_draws_an_image", async () => {
  expect(await drawsThroughScreens("t-a")).toBeTruthy();
});

it("u5985_a_bubble_draws_an_image", async () => {
  expect(await drawsThroughScreens("t-a")).toBeTruthy();
});

it.each([
  "https://example.com/a.png",
  "http://example.com/a.png",
  "file:///etc/passwd.png",
  "/Users/other/secret.png",
  "../../secret.png",
])("u5985_a_remote_or_foreign_path_is_not_loaded_%s", (source) => {
  const html = renderMarkdown(`![alt text](${source})`);

  expect(html).toContain("alt text");
  expect(html).not.toMatch(/<img|src=/);
});
