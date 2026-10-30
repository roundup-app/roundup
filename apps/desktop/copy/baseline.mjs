import * as v from 'valibot';

const eligible = new Set(['vocabulary', 'recovery-name', 'label-length', 'sentence-length', 'fragment', 'prose-as-label', 'duplicate-copy', 'unused-copy']);

const rowSchema = v.strictObject({
  rule: v.picklist([...eligible]),
  identity: v.pipe(v.string(), v.nonEmpty(), v.check(value => !value.includes('*'))),
  branch: v.pipe(v.string(), v.regex(/^(?:[0-9]+|literal:[a-f0-9]{12})$/)),
  fingerprint: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
});

const key = row => JSON.stringify([row.rule, row.identity, row.branch, row.fingerprint]);

export function inventory(diagnostics) {
  return [...new Map(diagnostics.flatMap(({ rule, identity, branch, fingerprint }) => {
    const row = { rule, identity, branch, fingerprint };

    return eligible.has(rule) ? [[key(row), row]] : [];
  })).values()];
}

/** The exact inventory can shrink; invalid, new, changed and stale rows fail. */
export function applyBaseline(diagnostics, baseline, previous) {
  const failures = [];
  const fail = (rule, identity, text) => failures.push({ file: 'copy/baseline.json', rule, identity, branch: '', fingerprint: '', text, message: `copy/baseline.json: ${identity}: ${rule}: ${text}` });
  const parsed = v.safeParse(v.array(rowSchema), baseline);

  if (!parsed.success) {
    fail('baseline-invalid', 'copy', 'Expected exact rule, identity, branch and SHA-256 rows');

    return [...failures, ...diagnostics];
  }

  const current = new Set(inventory(diagnostics).map(key));
  const earlier = previous == null ? current : new Set(previous.map(key));
  const allowed = new Set();

  for (const row of parsed.output) {
    if (allowed.has(key(row))) fail('baseline-duplicate', row.identity, 'Duplicate exemption');

    if (!earlier.has(key(row))) fail('baseline-expanded', row.identity, 'Exemption added or expanded');

    if (!current.has(key(row))) fail('baseline-stale', row.identity, 'Stale exemption after repair');
    allowed.add(key(row));
  }

  return [...failures, ...diagnostics.filter(row => !eligible.has(row.rule) || !allowed.has(key(row)))];
}
