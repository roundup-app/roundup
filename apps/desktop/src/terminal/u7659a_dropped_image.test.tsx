import { cleanup, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { info, terminal } from "../testing/nodes";
import { notices } from "../testing/notices";
import { mountPane } from "./paneHarness";

afterEach(cleanup);

const mount = async (terminals = [info("t-a")]) => {
  const mounted = await mountPane([terminal("a")], terminals);

  mounted.connected.rail.select("a");
  flush();
  const body = mounted.container.querySelector<HTMLElement>(".pane-body");

  if (body) body.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  await Promise.resolve();

  return mounted;
};

const drop = (paths: string[]) => ({ phase: "drop" as const, paths, x: 50, y: 50 });

describe("u7659a a dropped image is copied before its path is pasted", () => {
  it("u7659a_a_drop_of_two_images_pastes_both_copies_in_order", async () => {
    const { app, emulators } = await mount();

    app.savedDroppedPaths.set("/tmp/NSIRD/a.png", "/cache/one.png");
    app.savedDroppedPaths.set("/tmp/NSIRD/b.JPG", "/cache/two.jpg");
    app.dropFiles(drop(["/tmp/NSIRD/a.png", "/tmp/NSIRD/b.JPG"]));

    await waitFor(() => expect(emulators.get("t-a")?.pasted).toEqual(["'/cache/one.png' '/cache/two.jpg' "]));
    expect(app.droppedImages).toEqual(["/tmp/NSIRD/a.png", "/tmp/NSIRD/b.JPG"]);
  });

  it("u7659a_a_drop_of_other_files_pastes_them_as_u162_says", async () => {
    const { app, emulators } = await mount();

    app.savedDroppedPaths.set("/p/a.png", "/cache/a.png");
    app.dropFiles(drop(["/p/a.png", "/p/notes.txt", "/p/folder"]));

    await waitFor(() => expect(emulators.get("t-a")?.pasted).toEqual(["'/cache/a.png' '/p/notes.txt' '/p/folder' "]));
    expect(app.droppedImages).toEqual(["/p/a.png"]);
  });

  it("u7659a_a_failed_copy_shows_its_message_and_pastes_nothing_for_that_file", async () => {
    const { app, emulators } = await mount();

    app.saveImageFailure = new RpcError(-32002, "the image is 30 MiB, over the 20 MiB a drop can copy");
    app.dropFiles(drop(["/p/a.png", "/p/notes.txt"]));

    await waitFor(() => expect(notices("alert")).toHaveLength(1));
    expect(emulators.get("t-a")?.pasted).toEqual(["'/p/notes.txt' "]);

    app.dropFiles(drop(["/p/b.png"]));
    await Promise.resolve();
    await Promise.resolve();
    expect(emulators.get("t-a")?.pasted).toEqual(["'/p/notes.txt' "]);
  });

  it("u7659a_an_exited_terminal_copies_nothing", async () => {
    const { app, emulators } = await mount([info("t-a", { running: false, exit_code: 0 })]);

    app.dropFiles(drop(["/p/a.png"]));
    await Promise.resolve();

    expect(app.droppedImages).toEqual([]);
    expect(emulators.get("t-a")?.pasted).toEqual([]);
  });
});
