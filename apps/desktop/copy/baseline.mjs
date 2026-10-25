import * as v from "valibot";

const rowSchema = v.strictObject({
  rule: v.picklist(["vocabulary", "recovery", "length", "fragment", "duplicate"]),
  identity: v.pipe(v.string(), v.nonEmpty(), v.check(value => !value.includes("*"))),
  branch: v.pipe(v.number(), v.integer(), v.minValue(0)),
  fingerprint: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
});

const key = row => JSON.stringify([row.rule, row.identity, row.branch, row.fingerprint]);

const eligible = row => ['vocabulary', 'recovery', 'length', 'fragment', 'duplicate'].includes(row.rule);

/** Exact values only: file moves preserve an entry's stable identity and fingerprint. */
export function inventory(diagnostics) {
  return [...new Map(diagnostics.filter(eligible).map(({ rule, identity, branch, fingerprint }) => {
    const row = { rule, identity, branch, fingerprint };

    return [key(row), row];
  })).values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/** A repaired value retires its exemption in the same change; adding one never passes. */
export function applyBaseline(diagnostics, baseline, previous) {
  const failures = [];
  const current = new Set(inventory(diagnostics).map(key));
  const earlier = previous == null ? current : new Set(previous.map(key));
  const allowed = new Set();

  for (const row of baseline) {
    if (!v.safeParse(rowSchema, row).success) {
      failures.push({ rule: 'baseline', text: 'Invalid exact exemption', identity: row.identity });
      continue;
    }

    if (!earlier.has(key(row))) failures.push({ rule: 'baseline', text: 'Exemption added or expanded', identity: row.identity });

    if (!current.has(key(row))) failures.push({ rule: 'baseline', text: 'Stale exemption after repair', identity: row.identity });
    allowed.add(key(row));
  }

  return [...failures, ...diagnostics.filter(row => !eligible(row) || !allowed.has(key(row)))];
}
