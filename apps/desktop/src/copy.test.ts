import { copy } from "./terminal/copy";
import { copy as copyShared } from "./sharedCopy";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream } from "./testing/nodes";
import { mountRailAndPane } from "./terminal/paneHarness";

afterEach(cleanup);

import { candidates } from "../copy/provenance.mjs";
import { checkCopy } from "../copy/guard.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");

const sources = () => readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter((file) =>
  /\.tsx?$/.test(file) && !/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$|(^|\/)copy\.ts$|^sharedCopy\.ts$)/.test(file));

it("u471_every_app_authored_string_comes_from_the_catalogue", () => {
  const missing = sources().flatMap((file) => candidates(readFileSync(join(ROOT, file), "utf8")).map(({ line, text }) => `${file}:${line}: ${text}`));
  expect(missing).toEqual([]);
});

it("u471_catalogue_distinguishes_internal_fallback_props_from_app_copy", () => {
  expect(candidates(`
    let restored: "none" | "current" | "selected" = "none";
    const label = "recover";
    const failure = new Error("recovery failed");
    const view = <Show fallback={<RenameField restored={restored} aria-label="rename">
      Rename project{format(label)}
    </RenameField>} />;
    document.fonts.load(\`\${style} \${size}px \${family}\`);
  `)).toEqual([
    { line: 3, text: "recover" },
    { line: 4, text: "recovery failed" },
    { line: 5, text: "rename" },
    { line: 5, text: "Rename project" },
  ]);
});

it("u471_action_labels_describe_the_existing_action_retry_supervisor", async () => {
  const { app, connected } = await mountRailAndPane([workstream("w")]);

  app.handlers["rail.startDoor"] = () => { throw new Error("keep THIS launch failure 🧭"); };

  connected.rail.select("w");
  fireEvent.click((await screen.findAllByRole("button", { name: copy.start })).find((button) => button.closest(".pane-door"))!);
  const retry = (await screen.findAllByRole("button", { name: copyShared.retry })).find((button) => button.closest(".pane-door"))!;

  expect(document.body.textContent).toContain("keep THIS launch failure 🧭");
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  fireEvent.click(retry);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }, { id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
  expect(app.calls.filter((call) => call.method === "rail.createWorkstream")).toEqual([]);
});

// U471 requires the entry point and every production caller to move together.
it("u471_copy_modules_belong_to_their_surfaces", () => {
  const files = Object.fromEntries(readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter(file => /\.tsx?$/.test(file)).map(file => [file, readFileSync(join(ROOT, file), "utf8")]));
  expect(checkCopy(files, "", { ownershipOnly: true })).toEqual([]);
});
