import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountRail, railCallsTo } from "../rail/railFixture";
import { workstream } from "../testing/nodes";
import { RpcError } from "./seam";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each([-32603, -32004, -32006, -32008, 42])("u3791b_connected_submit_retains_unknown_revision_%s", async code => {
  const mounted = await mountRail([workstream("w")]);
  let reject!: (error: Error) => void;
  mounted.app.handlers["agent.spawn"] = () => new Promise((_, no) => { reject = no; });
  fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
  const field = screen.getByLabelText<HTMLTextAreaElement>("Work");
  fireEvent.input(field, { target: { value: " exact submitted 🌿\n " } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.input(field, { target: { value: " newer work e\u0301 " } });
  await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1));
  reject(new RpcError(code, "refused; refresh and choose again"));
  await waitFor(() => expect(mounted.connected.drafts.list().some(draft => draft.status === "unknown")).toBe(true));
  const submitted = mounted.connected.drafts.list().find(draft => draft.status === "unknown")!;
  expect(submitted.value.text).toBe(" exact submitted 🌿\n ");
  expect(submitted.destination.object).toBe("/p");
  expect(field.value).toBe(" newer work e\u0301 ");
  expect(railCallsTo(mounted.app, "agent.spawn")).toHaveLength(1);
});
