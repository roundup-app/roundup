# U478 check integration

#1861 supplies only the integration prerequisite for #1852, under #1629’s completed shared-manifest ownership. Bootstrap configuration arrived in #1884; Radix dependency and imports arrived atomically in #1891; stylesheet discovery was repaired in #1911. No component CSS, Token rules, retirement or generated reference is delivered here.

```text
just check [origin/main]
  check-web → lint-web
    pnpm lint:styles → apps/desktop/src/**/*.css (filesystem discovery)
    pnpm tokens:check → docs/ui-tokens.test.mjs, when supplied by #1852
```

`lint:styles` uses Stylelint’s recursive glob and `--max-warnings 0`. It always runs, independent of the affected-test selection. The existing bootstrap configuration loads strict-value with error severity. No App directory is ignored. The separate duration observer and all existing checks remain in place.

`tokens:check` reserves the explicit Node test entry point `docs/ui-tokens.test.mjs`. Its absence is the bootstrap state; #1852 supplies the actual generator, output and freshness assertion there without changing shared manifests. Once present, a nonzero observer exit fails both check modes. This hook alone makes no stale-reference claim.

## Selected tools

Verified against npm registry metadata on 2026-10-15, using Node 22.23.3:

| Tool | Exact version | Compatibility and maintenance |
| --- | --- | --- |
| Stylelint | 17.16.0 | Node ≥20.19; [release](https://github.com/stylelint/stylelint/releases/tag/17.16.0) published 2026-10-01; [registry](https://registry.npmjs.org/stylelint) |
| stylelint-declaration-strict-value | 1.12.1 | Peer Stylelint ≥16 ≤17, Node ≥20.19; published 2026-08-24; [source](https://github.com/AndyOGo/stylelint-declaration-strict-value), [registry](https://registry.npmjs.org/stylelint-declaration-strict-value) |
| Radix Colors | 3.0.0 | Already pinned and consumed on main by #1891; published 2023-10-02; [registry](https://registry.npmjs.org/@radix-ui%2fcolors), [source maintenance](https://github.com/radix-ui/colors/commit/dbdb85470547c7d34b9001f48fddb08ded335979) 2025-12-17 |

Reuse: U478 selects Stylelint plus strict-value. [csstree-validator](https://github.com/csstree/stylelint-validator) validates CSS grammar but accepts literal lengths and colours, so cannot enforce Token references. Core [custom-property-pattern](https://stylelint.io/user-guide/rules/custom-property-pattern/) constrains property names rather than declaration values. No custom literal scanner is added.

## Integration observer

Run `pnpm test:token-integration` explicitly in an otherwise idle checkout before #1852 supplies its reserved observer. It creates an untracked App stylesheet, invokes both real check modes for raw padding, proves Token-backed acceptance and freshness failure propagation through their shared `lint-web` boundary, then runs a clean `just check origin/main`. Each invocation writes a complete temporary log and reports its actual exit. Fixtures are removed; existing files are never overwritten. The observer is kept out of `check` to avoid recursion. It proves the integration boundary, not U478’s full property matrix or generated-reference semantics.
