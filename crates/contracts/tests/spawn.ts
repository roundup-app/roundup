import type { RpcMethods } from "../../../contracts/generated/methods";

// A36: existing callers may omit both fields or pass opaque ids.
const a36_spawn_pairs = [
  { cwd: "/project", prompt: null, parent: null },
  { cwd: "/project", prompt: null, parent: null, model: "model-id", effort: "effort-id" },
] satisfies RpcMethods["agent.spawn"]["params"][];

// U378: immediate add and the picker's default pass explicit nulls;
// picking only a Model leaves Effort at the Project default.
const u378_spawn_pairs = [
  { cwd: "/project", prompt: null, parent: null, model: null, effort: null },
  { cwd: "/project", prompt: null, parent: null, model: "model-id", effort: null },
] satisfies RpcMethods["agent.spawn"]["params"][];

void a36_spawn_pairs;

void u378_spawn_pairs;
