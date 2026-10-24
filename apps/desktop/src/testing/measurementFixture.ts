import type { MeasurementSummary } from "@contracts/project/MeasurementSummary";

/** Agent `a` spent 13 s working, 4 s in tools, 2 s waiting on the user and 1 s coordinating; `b` spent 8 s working. The rest are removed Agents with no time. */
export const measurementFixture = (home = "home", revision = "1", offset = 0): MeasurementSummary => {
  const none = { elapsed_ns: "10000000000", summed_ns: "0", execution_ns: "0", tools_ns: "0", human_ns: "0", coordination_ns: "0", other_ns: "0", unmeasured_ns: "0", active: false, coverage: [] };
  const a = { ...none, summed_ns: "20000000000", execution_ns: "13000000000", tools_ns: "4000000000", human_ns: "2000000000", coordination_ns: "1000000000" };
  const b = { ...none, summed_ns: "8000000000", execution_ns: "8000000000" };
  const time = { ...a, summed_ns: "28000000000", execution_ns: "21000000000" };

  return structuredClone({ project: "/p", home, revision, cause: null, last_observed: 1000, time, coverage: ["Fixture coverage"], contributors: 1005, rows: Array.from({ length: Math.min(20, 1005 - offset) }, (_, i) => { const id = i + offset === 0 ? "a" : i + offset === 1 ? "b" : `former-${i + offset}`;

 return { agent: id, maker: id, removed: id !== "a", time: id === "a" ? a : id === "b" ? b : none, coverage: [] }; }), next_offset: offset + 20 < 1005 ? offset + 20 : null });
};
