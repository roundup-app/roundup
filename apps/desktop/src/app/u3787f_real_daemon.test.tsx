import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { App } from "../App";
import { createServedApp } from "../testing/realSeam";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import type { NativeOpen } from "./seam";
import { linkCopy } from "../copy/link";

let first: StartedDaemon;

let second: StartedDaemon;

beforeAll(async () => {
  first = await startRealDaemon({});
  second = await startRealDaemon({});
}, 120_000);

afterAll(async () => { await first?.stop(); await second?.stop(); });

afterEach(cleanup);

it("u3787f_deep_link_preserves_identity_and_authority_same_named_pad_in_another_project", async () => {
  const a = createServedApp(first.base);
  const b = createServedApp(second.base);
  const name = "notes 雪";
  const firstText = "wrong Project";
  const secondText = "# Details\nExact second Project section";
  await a.rpc("pad.create", { name, text: firstText });
  await b.rpc("pad.create", { name, text: secondText });

  const key = (await b.rpc("daemon.ping", null)).projectKey;

  const projects = [
    { name: "First", path: first.dir, running: true },
    { name: "Second", path: second.dir, running: true },
  ];

  a.projects = async () => projects;
  a.forProject = path => path === first.dir ? a : b;

  let receive: ((request: NativeOpen) => void) | undefined;
  a.onNativeOpen = async listener => { receive = listener;

    return () => {}; };

  render(() => <App app={a} reducedMotion={() => true} clock={() => 0} />);
  await waitFor(() => expect(receive).toBeDefined());
  receive?.({ kind: "link", url: `roundup://pad/${encodeURIComponent(name)}?project=${encodeURIComponent(key)}#Details` });
  const body = await screen.findByRole("textbox", { name: "Pad body" });
  await waitFor(() => expect(body.textContent).toContain(secondText.split("\n")[1]));
  expect(body.textContent).not.toContain(firstText);
  expect(await a.rpc("pad.read", { name })).toMatchObject({ text: firstText });
  expect(await b.rpc("pad.read", { name })).toMatchObject({ text: secondText });
  receive?.({ kind: "link", url: `roundup://pad/missing?project=${encodeURIComponent(key)}` });
  await screen.findByText(/missing/);
  expect(screen.queryByText(/another Project/)).toBeNull();
  projects.splice(1, 1);
  receive?.({ kind: "link", url: `roundup://pad/${encodeURIComponent(name)}?project=${encodeURIComponent(key)}` });
  await screen.findByText(linkCopy.projectClosed);
  expect(await b.rpc("rail.tree", null)).toEqual([]);
});
