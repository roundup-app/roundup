import { afterEach, describe, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { connectProject } from "../state/connectedProject";
import { OWN_CONTRACT } from "./contractMatch";

const ping = { pong: true, pid: 1, project: "/p", projectKey: "p-0000000000000000", contract: { fingerprint: OWN_CONTRACT.fingerprint } } as const;

const connect = async (extra: { forkColour?: "blue" }) => {
  const app = createFakeApp();

  app.handlers["daemon.ping"] = () => ({ ...ping, ...extra });
  await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
};

afterEach(() => { delete document.documentElement.dataset.forkColour; });

describe("u6044a the root wears the Fork's colour", () => {
  it("u6044a_app_sets_the_root_attribute_from_ping", async () => {
    await connect({ forkColour: "blue" });

    expect(document.documentElement.dataset.forkColour).toBe("blue");
  });

  it("u6044a_live_app_sets_no_root_attribute", async () => {
    document.documentElement.dataset.forkColour = "red";
    await connect({});

    expect(document.documentElement.hasAttribute("data-fork-colour")).toBe(false);
  });
});
