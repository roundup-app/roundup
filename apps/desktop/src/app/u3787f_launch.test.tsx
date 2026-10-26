import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import type { NativeOpen } from "./seam";

let receive: ((request: NativeOpen) => void) | undefined;
afterEach(() => { cleanup(); window.localStorage.clear(); receive = undefined; });

it("u3787f_second_launch_reuses_the_app_opens_the_delivered_project", async () => {
  const app = createFakeApp();
  app.onNativeOpen = async listener => { receive = listener; return () => {}; };
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await waitFor(() => expect(receive).toBeDefined());
  receive?.({ kind: "project", path: "/invocation/second" });
  await screen.findByRole("tab", { name: "second" });
  expect(app.calls.filter(call => /spawn|start|input|write/.test(call.method))).toEqual([]);
});

it("u3787f_deep_link_preserves_identity_and_authority_refuses_without_opening_a_path", async () => {
  const app = createFakeApp();
  app.onNativeOpen = async listener => { receive = listener; return () => {}; };
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await waitFor(() => expect(receive).toBeDefined());
  receive?.({ kind: "link", url: "roundup://pad/notes?project=unavailable" });
  await screen.findByText(/Project.*not open/);
  expect(app.calls.filter(call => /spawn|start|input|write/.test(call.method))).toEqual([]);
});
