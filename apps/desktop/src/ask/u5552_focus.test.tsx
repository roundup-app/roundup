import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountApp, select, rpcCalls } from "../testing/appFixture";
import { info } from "../testing/nodes";
import { pasteEvent } from "../testing/clipboard";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u5552f_ask_has_no_direct_terminal_write", async () => {
  const { app } = await mountApp(app => {
    app.handlers["terminal.list"] = () => [info("t-a"), info("t-b")];
    app.handlers["ask.send"] = request => ({ id: "asked", text: request.text, at: 0n, parts: [] });
  });

  select("alpha");
  select("beta");
  fireEvent.keyDown(document.activeElement!, { key: "/", code: "Slash", metaKey: true });
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Ask" });
  field.focus();
  pasteEvent(field, "pasted 界");
  fireEvent.input(field, { target: { value: "pasted 界 and typed" } });
  expect(rpcCalls(app, "terminal.write")).toEqual([]);
  fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(rpcCalls(app, "ask.send")).toHaveLength(1));
  expect(rpcCalls(app, "ask.send")).toMatchObject([{ text: "pasted 界 and typed" }]);
  expect(rpcCalls(app, "ask.send")[0]).not.toHaveProperty("workstream");
  expect(rpcCalls(app, "terminal.write")).toEqual([]);
  expect(document.activeElement?.closest('[data-terminal]')).toBeNull();
});
