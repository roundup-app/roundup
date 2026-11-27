import type { Reach } from "./owned";
import { createEffect, createSignal, untrack } from "solid-js";
import type { Account } from "@contracts/agent/Account";
import { unknownOutcomeLine } from "../app/failureOf";
import { type Applied, applying } from "../app/pending";
import { RpcError, type AppSeam } from "../app/seam";
import { useConnectedProject } from "../state/connectedProject";
import { resolvedWorkstream } from "../state/railTopology";
import { copy } from "./copy";
import { type Call, panelLabel, parseDiagram, partsOf } from "./diagram";
import { gapsOf, type ReadbackState } from "./readback";

/** The Daemon's answer to a Pad name that is taken (P1). */
const CONFLICT = -32003;

/** U7702d: the names a save tries, the name and then it with " 2" and on, before it gives up. */
const TRIES = 20;

/** U7702e: a Mermaid label in quotes, its quote and backtick as numeric entities so no part's name ends the label or the fence. */
const quoted = (part: string) => `"${part.replace(/["`]/g, mark => `#${mark.charCodeAt(0)};`)}"`;

/** U7702e: the calls of one panel as a Mermaid flowchart fence (P2544e), each part a generated node id with its own label. */
const flowchart = (calls: readonly Call[]) => {
  const parts = partsOf(calls);
  const node = (part: string) => `n${parts.indexOf(part)}[${quoted(part)}]`;

  return ["```mermaid", copy.padFlowchart, ...calls.map(([from, to]) => `  ${node(from)} --> ${node(to)}`), "```"].join("\n");
};

/** U7702d: the day a Pad's name and text carry, as `YYYY-MM-DD` in the user's time zone. */
const dayOf = (time: number) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", numberingSystem: "latn" }).format(time);

/** U7702d: the Pad's name, the Agent's name without what a Pad name refuses (P8). */
const nameOf = (agent: string, day: string) => copy.readbackPadName(agent.replace(/[\\/]+/g, "-").replace(/\.{2,}/g, "."), day);

const heading = (title: string, blocks: readonly string[]) => blocks.length > 0 ? [`## ${title}`, ...blocks] : [];

/** U7702b: the readback as the Pad's markdown: who and when, the overview, the diagram, the modules, the flows and the gaps; a part with nothing to show is left out. */
export const readbackText = (input: { agent: string; day: string; from: string; to: string; account: Account; stale: boolean }) => {
  const { account, agent } = input;

  const diagram = parseDiagram(account.diagram).flatMap(panel => [
    ...panelLabel(panel) ? [`**${panelLabel(panel)}**`] : [],
    ...panel.calls.length > 0 ? [flowchart(panel.calls)] : [],
    ...panel.words.length > 0 ? [panel.words.map(words => `- ${words}`).join("\n")] : [],
  ]);

  const modules = account.modules.length > 0 ? [account.modules.map(each => `- **${each.module}**: ${each.account}`).join("\n")] : [];
  const flows = account.flows.map(flow => `### ${flow.name}\n\n${flow.steps.map((step, at) => `${at + 1}. ${step.note}`).join("\n")}`);
  const gaps = gapsOf(account).map(gap => `- ${copy.gapSaid(agent, gap.said)} ${copy.gapDiff(gap.quote)} (${gap.path}:${gap.line})`);

  return [
    `# ${nameOf(agent, input.day)}`,
    [[copy.padDate, input.day], [copy.compareFrom, input.from], [copy.compareTo, input.to]].map(([label, value]) => `- ${label}: ${value}`).join("\n"),
    ...input.stale ? [`> ${copy.changedSinceReadback}`] : [],
    ...heading(copy.overview, [account.overview]),
    ...heading(copy.diagram, diagram),
    ...heading(copy.lenses.modules, modules),
    ...heading(copy.lenses.flows, flows),
    ...heading(copy.gaps, gaps.length > 0 ? [gaps.join("\n")] : []),
  ].join("\n\n") + "\n";
};

/** U7702d: creates the Pad under `name`, or under it with " 2", " 3" and on while the Daemon says the name is taken; answers how it ended and, when it applied, the name it made. */
const create = async (app: AppSeam, name: string, text: string): Promise<Applied<string>> => {
  for (let at = 1; ; at += 1) {
    const tried = at === 1 ? name : `${name} ${at}`;
    const made = await applying(() => app.rpc("pad.create", { name: tried, text }));
    const taken = made.kind === "refused" && made.thrown instanceof RpcError && made.thrown.code === CONFLICT;

    if (!taken || at === TRIES) return made.kind === "applied" ? { kind: "applied", value: tried } : made;
  }
};

/** U7702b, U7702c: where one save stands: saving, saved, saved but left at the Project root with the move's cause, not saved with the cause, or sent with no answer (U5172a). */
export type PadSave = { kind: "saving" } | { kind: "saved"; name: string } | { kind: "notMoved"; name: string; cause: string } | { kind: "failed"; cause: string } | { kind: "unknown"; cause: string };

/**
 * U7702: the user's save of the shown readback as a Pad: `pad.create`, then `pad.move` to the Agent's nearest Workstream (`CreateParams` has no home, P12), none for an Agent under no Workstream.
 * Only `save` calls the Daemon, and only the user's click calls `save`. A new run of the readback ends what the last save said.
 */
export const createReadbackPad = (input: { id: string; agent: () => string; readback: ReadbackState; at: () => Reach | null }) => {
  const { app, rail, now } = useConnectedProject();
  const [status, setStatus] = createSignal<PadSave>();
  let generation = 0;

  createEffect(() => input.readback.state().state === "reading", reading => {
    if (!reading) return;
    generation += 1;
    setStatus(undefined);
  });

  return {
    status,
    save: async () => {
      const read = input.readback.read();
      const at = untrack(input.at);

      if (!read || !at || status()?.kind === "saving") return;

      const mine = generation;
      const day = dayOf(now());
      const agent = input.agent();
      const home = resolvedWorkstream(rail.nodes, input.id);

      const settle = (next: PadSave) => { if (mine === generation) setStatus(next); };

      setStatus({ kind: "saving" });

      const made = await create(app, nameOf(agent, day), readbackText({ agent, day, from: copy.remoteMain, to: !("to" in at) ? copy.changes : at.to === "tree" ? copy.targetTree : copy.targetBranch, account: read.account, stale: read.stale }));

      if (made.kind !== "applied") return settle(made.kind === "refused" ? { kind: "failed", cause: made.error.message } : { kind: "unknown", cause: unknownOutcomeLine(made.error) });

      const name = made.value;
      const moved = home === null ? null : await applying(() => app.rpc("pad.move", { name, home }));

      if (moved === null || moved.kind === "applied") return settle({ kind: "saved", name });

      settle(moved.kind === "refused" ? { kind: "notMoved", name, cause: moved.error.message } : { kind: "unknown", cause: unknownOutcomeLine(moved.error) });
    },
  };
};

export type ReadbackPad = ReturnType<typeof createReadbackPad>;
