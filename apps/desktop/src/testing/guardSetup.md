# S3806 cheap guards

The runner owns selection. Run every available prescribed class guard with:

```sh
pnpm --filter desktop exec vitest run --project webkit-guards --retry=0
```

S3806b remains incomplete until `src/ui/s3806b_actions.test.tsx` merges. Parent
#3850 must verify all three guards before completion. The Switcher U2572 suite
is an existing regression observer, not the S3806b guard.

## Baseline observation

At main `c9c69c69f6ff685dc81cd579b806abb45306a64e`, the three-file invocation in
#4440 unconditionally enters `warmChrome` and `globalAppServer`. A Linux
`strace -f -e trace=execve,bind,listen` observation recorded a real headless
Chrome launch with a fresh `chrome-page-*` profile and App-server listening.
It logged `Chrome first start: 11984 ms`. Passing jsdom assertions do not prove
a browser-free invocation.

Keep #3828's timing and proof requirements: report setup separately from file
times, retain original failures, and make no aggregate CI saving claim from a
local measurement. Do not change real-Claude, Rust or U26 failure observers.
