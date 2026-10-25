# U26 bpftrace compatibility

Runner: Ubuntu 26.04.1 LTS (Resolute), x86_64,
Linux 7.0.0-1017-azure, bpftrace v0.25.0 (Ubuntu 0.25.0-1ubuntu1),
LLVM 21.1.8. Baseline: `a284e11af9d48e9fad4f83fba29bfc757019e3e3`.

The unchanged tracer aborts before attachment:

```text
bpftrace: ./src/ast/irbuilderbpf.cpp:248:
llvm::AllocaInst* bpftrace::ast::IRBuilderBPF::CreateAllocaBPF(llvm::Type*, const std::string&):
Assertion `module_.getDataLayout().getTypeAllocSize(ty) <= 256' failed.
```

| Baseline command | Result | Exit |
| --- | --- | --- |
| `python3 loop/app-data.py python3 tools/chromium-faults/test.py` | 11 tests, 6 failures and 1 error; 114.952 s | 1 |
| `python3 loop/app-data.py python3 tools/chromium-faults/cold.test.py` | 4 tests, 1 failure (observer never attached); 124.986 s | 1 |

Initial setup attempts also exited 1: fault tests lacked libfuse3 development
files (7 errors), and cold tests lacked the worktree's pnpm dependencies
(4 errors). Installed the dependencies before the baseline above. Ubuntu's
fusermount3 AppArmor profile also denied fixture cleanup capabilities; the
runner's local profile grants `dac_override` and `setuid` for subsequent runs.
No repository checks or assertions were changed for setup.
