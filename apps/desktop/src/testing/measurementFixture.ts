import type { MeasurementSummary } from "@contracts/project/MeasurementSummary";
import type { ConsumedCategory } from "@contracts/project/ConsumedCategory";

const subtotal = (known: string) => ({ known, missing: 0 });

export const measurementFixture = (home = "home", category: ConsumedCategory = "total", revision = "1", offset = 0): MeasurementSummary => {
  const a = { input: subtotal("100"), output: subtotal("20"), cache_read: subtotal("400"), cache_write: subtotal("50"), total: subtotal("570") };
  const b = { input: subtotal("200"), output: subtotal("30"), cache_read: subtotal("0"), cache_write: subtotal("0"), total: subtotal("230") };
  const cost = { reported: [], reference: [], unavailable: ["Fixture has no price basis"] };
  const time = { elapsed_ns: "10000000000", summed_ns: "20000000000", execution_ns: "13000000000", tools_ns: "4000000000", human_ns: "2000000000", coordination_ns: "1000000000", other_ns: "0", unmeasured_ns: "0", active: false, coverage: [] };
  const agents = category === "output" ? ["b", "a"] : ["a", "b"];

  return structuredClone({ project: "/p", home, revision, category, cause: null, last_observed: 1000, tokens: { input: subtotal("300"), output: subtotal("50"), cache_read: subtotal("400"), cache_write: subtotal("50"), total: subtotal("800") }, cost, time, coverage: ["Fixture coverage"], contributors: 1005, rows: Array.from({ length: Math.min(20, 1005 - offset) }, (_, i) => { const id = i + offset < 2 ? agents[i + offset]! : `former-${i + offset}`;

 return { agent: id, maker: id, removed: id !== "a", tokens: structuredClone(id === "a" ? a : id === "b" ? b : { input: subtotal("0"), output: subtotal("0"), cache_read: subtotal("0"), cache_write: subtotal("0"), total: subtotal("0") }), cost: structuredClone(cost), time: structuredClone(time), coverage: [] }; }), next_offset: offset + 20 < 1005 ? offset + 20 : null });
};
