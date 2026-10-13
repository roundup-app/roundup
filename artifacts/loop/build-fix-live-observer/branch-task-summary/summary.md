Fix acquired branch `build/l106-collector-authorized-dispatch`; task preparation waits for any build or fix holding it to end.
Observed head: `14eb6d93a0acf745af3a6744f1e8f4172650cc7a`; cause head: `0000000000000000000000000000000000000000`.
Skip fix: the build or another writer moved the head; the original cause belongs to an older head. The newest head gets its own checks and fix.
