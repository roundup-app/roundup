# Token check integration (U478 clauses 4, 5 and 8)

#1861 supplies dependencies and check wiring after #1629 and #1881.
#1852 owns final category rules, the generator and output, test retirement and
rendered regression evidence. This boundary does not deliver all of U478.

Both `just check` and `just check origin/main` must run Stylelint against
`apps/desktop/src/**/*.css`, including untracked files, with zero warnings.
With the bootstrap configuration, a fresh `apps/desktop/src/u478-probe.css`
containing `.probe { padding: 7px }` must fail with
`scale-unlimited/declaration-strict-value` naming that file. Replacing the value
with `var(--space-1)` must pass; removing the file must pass.

The freshness integration uses the existing workspace package-script dispatcher.
#1852 supplies a desktop `tokens:check` script that exits nonzero for stale
reference output and zero for current output. `lint-web` invokes that script
through `just packages tokens:check` on every check, independently of the diff.
Until the owning script is supplied, the dispatcher has no freshness observer;
this is a hook, not a claim that stale output is already detected.

For each real check entry point, temporarily supply a desktop `tokens:check`
script that exits 19, assert the check fails naming that script, then replace it
with a successful script and assert success. Restore the manifest afterward.
The generator's actual stale-output fixture belongs to #1852.
