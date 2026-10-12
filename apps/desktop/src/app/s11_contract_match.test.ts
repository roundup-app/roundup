import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { RpcMethods } from "@contracts/methods";
import { CONTRACT } from "@contracts/contract";
import { createFakeApp } from "../testing/fakeApp";
import { connectProject } from "../state/connectedProject";
import { createTauriApp } from "./tauri";

const ours = [...CONTRACT.methods];

const connectTo = async (contract: { fingerprint: string; methods: string[] } | undefined) => {
  const app = createFakeApp();

  // SAFETY: a Daemon built before A38 answers `{ pong: true }`, which the generated result type no longer allows.
  const old = { pong: true } as RpcMethods["daemon.ping"]["result"];

  app.handlers["daemon.ping"] = () => (contract ? { pong: true, contract } : old);

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

  return { app, connected };
};

afterEach(clearMocks);

describe("s11 the App says when the Daemon is not the one it was built with", () => {
  it("s11_equal_contracts_show_no_notice", async () => {
    const { connected } = await connectTo({ fingerprint: CONTRACT.fingerprint, methods: ours });

    expect(connected.contractNotice).toBeNull();
  });

  it("s11_an_older_daemon_is_named_before_any_call", async () => {
    const { app, connected } = await connectTo({ fingerprint: "old", methods: ours.slice(1) });

    expect(connected.contractNotice).toBe("The Daemon is older than the App. Quit and run `just app` again to rebuild it.");
    expect(app.calls[0]?.method).toBe("daemon.ping");
    expect(app.calls.filter((call) => call.method === "daemon.ping")).toHaveLength(1);
  });

  it("s11_a_newer_daemon_is_named", async () => {
    const { connected } = await connectTo({ fingerprint: "new", methods: [...ours, "future.method"] });

    expect(connected.contractNotice).toBe("The Daemon is newer than the App. Quit and run `just app` again to rebuild it.");
  });

  it("s11_a_mixed_difference_says_they_differ", async () => {
    const mixed = await connectTo({ fingerprint: "x", methods: [...ours.slice(1), "future.method"] });
    const retyped = await connectTo({ fingerprint: "x", methods: ours });
    const text = "The App and the Daemon differ. Quit and run `just app` again to rebuild it.";

    expect(mixed.connected.contractNotice).toBe(text);
    expect(retyped.connected.contractNotice).toBe(text);
  });

  it("s11_a_daemon_without_a_contract_is_older", async () => {
    const { connected } = await connectTo(undefined);

    expect(connected.contractNotice).toBe("The Daemon is older than the App. Quit and run `just app` again to rebuild it.");
  });

  it("s11_method_not_found_names_the_method_and_the_difference", async () => {
    mockIPC(() => {
      throw { code: -32601, message: "method not found: models.list" };
    });

    await expect(createTauriApp().forProject("/p").rpc("models.list", null)).rejects.toMatchObject({
      code: -32601,
      message: "models.list: the App and the Daemon differ. Quit and run `just app` again to rebuild it.",
    });
  });
});
