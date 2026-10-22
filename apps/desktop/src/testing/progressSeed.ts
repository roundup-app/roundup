import type { ContinuationAction } from "@contracts/message/ContinuationAction";
import type { Progress } from "@contracts/message/Progress";
import type { Reconciliation } from "@contracts/message/Reconciliation";
import type { ResultObservation } from "@contracts/message/ResultObservation";
import type { ResultProgress } from "@contracts/message/ResultProgress";
import type { ResultState } from "@contracts/message/ResultState";
import type { Resolution } from "@contracts/deliverable/Resolution";
import { USER } from "../pads/owner";

type Seed = { project: string; agent: string };

const result = (seed: Seed, key: string, over: {
  result: string; target: string; revision: string; next?: string; current?: boolean; state?: ResultState;
  accepted?: boolean; observations?: ResultObservation[]; availability?: Resolution;
}): ResultProgress => ({
  report: {
    order_revision: "order-1",
    report: key,
    author: { kind: "agent", id: seed.agent, parent: null },
    attempt: "attempt-1",
    home: null,
    request: {
      project: seed.project, id: seed.agent, key, delivery: "delivery-1", target: { id: over.target, revision: over.revision },
      output: { project: seed.project, id: `output-${key}` }, result: over.result, next: over.next ?? "", state: over.state ?? "reported",
      check: { kind: "publication", sha256: "0".repeat(64) },
    },
    instruction: { revision: "instruction-1", agent: seed.agent, workstream: null, kind: "order", order: { kind: "work", ask: "Fix login", limits: [] } },
    publication: {
      project: seed.project, id: `output-${key}`, maker: { kind: "agent", id: seed.agent, parent: null }, maker_name: "alpha", home: null,
      title: `${over.target} ${over.revision}`, published_at: 1, target: { kind: "file", path: "output.txt", length: 1, sha256: "0".repeat(64) },
    },
  },
  current: over.current ?? true,
  acceptances: over.accepted ? [{ actor: USER, evidence: "Read it through" }] : [],
  observations: over.observations ?? [],
  availability: over.availability ?? { kind: "retained", path: "/p/output.txt", sha256: "0".repeat(64) },
});

/** U3078i's densest seed: accepted and checked work, an older version, an unavailable output, unknown effects and one unfinished repair. */
export const progressSeed = (seed: Seed) => {
  const results = [
    result(seed, "r-old", { result: "Login output, first try", target: "login", revision: "v1", current: false, accepted: true, observations: [{ verdict: "passed", revision: "obs-1" }] }),
    result(seed, "r-login", {
      result: "Login output with the repair still pending", target: "login", revision: "v2", next: "Repair login; then run final checks", accepted: true,
      observations: [{ verdict: "passed", revision: "obs-2" }],
    }),
    result(seed, "r-gone", { result: "Release notes draft", target: "notes", revision: "v1", availability: { kind: "unavailable", cause: "missing-revision" } }),
    result(seed, "r-deploy", {
      result: "Deployment of the login fix to the production cluster with a very long unbreakable name production-cluster-eu-west-1-blue",
      target: "deployment", revision: "v1", state: "unknown-effect",
    }),
  ];

  const action: ContinuationAction = {
    id: "action-login", report: "r-login", target: { id: "login", revision: "v2" }, output: "output-r-login",
    instruction: "instruction-1", next: "Repair login; then run final checks", decision: null,
  };

  return {
    progress: { instructions: { project: seed.project, home: null, current: "instruction-1", revisions: [], deliveries: [] }, results },
    action,
    plan: {
      agent: seed.agent, actions: [action], context: [], pending_checks: [{ id: "notes", revision: "v1" }, { id: "login", revision: "v2" }],
      blocked: [
        { report: "r-deploy", target: { id: "deployment", revision: "v1" }, cause: "the effect was issued without an authoritative acknowledgement, so it may have happened", action: "Read the authoritative receipt for this exact target and version; never issue the effect again to find out" },
        { report: "r-gone", target: { id: "notes", revision: "v1" }, cause: "the published output is unavailable and is never replaced by current bytes", action: "Inspect the exact published result; republish it or accept that it is gone" },
      ],
    },
  };
};
