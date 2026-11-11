import { expect, it } from "vitest";
import { createMenuWriter } from "./menuBar";

it("u450_the_latest_menu_write_wins", async () => {
  const sent: Array<string | null> = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let latest = { path: "/a", items: [] };

  const app = {
    selectProjectMenu: async (path: string | null) => {
      sent.push(path);

      if (sent.length === 1) await gate;
    },
  };
  const write = createMenuWriter(app, message => { throw new Error(message); });
  const first = write(() => latest);

  latest = { path: "/b", items: [] };
  await write(() => latest);
  expect(sent).toEqual(["/a"]);
  release();
  await first;
  expect(sent).toEqual(["/a", "/b"]);
});
