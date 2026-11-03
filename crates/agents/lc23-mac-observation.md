# LC23 Mac observation

LC23: PASS
Both crash cases blocked Write and Edit without file changes; the restored program passed LC21.
Implementation commit: 9f5a450f5b7e1beec61deb61141881e377882a02
Claude Code: 2.1.316; Haiku 5.5, selected as haiku; four Door prompts.
Launch: rail.startDoor, Workstream 1, Door Terminal 1, PID 36665; isolated rupd PID 36364.
Permission mode: auto, inherited from the user; all four failing hook payloads report auto. LC21 used the same Door and mode.
Project: /tmp/loop-own/lc23/project, a fresh git repository.
Data: ROUNDUP_DATA_DIR=/tmp/loop-own/lc23/data.
Memory: /private/tmp/loop-own/lc23/data/memory, configured in the test Project and confirmed by actual saved files.
Build: CARGO_TARGET_DIR=/tmp/loop-own/lc23/target cargo build -p rupd -p rup; passed.
Generated hook command (unchanged throughout):
if rup_memory_output=$(/tmp/loop-own/lc23/evidence/rup claude-memory /private/tmp/loop-own/lc23/data/memory /private/tmp/loop-own/lc23/project && printf '.'); then printf '%s' "${rup_memory_output%.}"; else printf '%s\n' 'Memory guard failed; hand the work to a child Agent.' >&2; exit 2; fi
Effective onFailure: block; synchronous PreToolUse, matcher Write|Edit, timeout 5 seconds.
Generated settings SHA-256 before and after: d15eb9456e209dff1400c2ea9c8941f5d565bf9253c647090676acd29cbfebb1
Only evidence/rup was replaced; non-memory commands forwarded to target/debug/rup. It is now restored as a symlink to that real binary.

Exit 101; Write; tool id toolu_01FBiCLdyQT53BquiVePUWhD.
Vendor blocking reason verbatim:
PreToolUse:Write hook error: [if rup_memory_output=$(/tmp/loop-own/lc23/evidence/rup claude-memory /private/tmp/loop-own/lc23/data/memory /private/tmp/loop-own/lc23/project && printf '.'); then printf '%s' "${rup_memory_output%.}"; else printf '%s\n' 'Memory guard failed; hand the work to a child Agent.' >&2; exit 2; fi]: Memory guard failed; hand the work to a child Agent.
New sentinel absent: yes; /tmp/loop-own/lc23/project/exit101-new.txt
Existing sentinel: /tmp/loop-own/lc23/project/exit101-existing.txt
Existing bytes before and after: "LC23 exit101 original bytes\n"
Existing SHA-256 before: f20e9ec31cc1c3cd2a058ca1337058960f2f6ded5c36ba021c465850bb9dbef3
Existing SHA-256 after:  f20e9ec31cc1c3cd2a058ca1337058960f2f6ded5c36ba021c465850bb9dbef3

Exit 101; Edit; tool id toolu_015EtQbDNoovq3DfCb7gcoEQ.
Vendor blocking reason verbatim:
PreToolUse:Edit hook error: [if rup_memory_output=$(/tmp/loop-own/lc23/evidence/rup claude-memory /private/tmp/loop-own/lc23/data/memory /private/tmp/loop-own/lc23/project && printf '.'); then printf '%s' "${rup_memory_output%.}"; else printf '%s\n' 'Memory guard failed; hand the work to a child Agent.' >&2; exit 2; fi]: Memory guard failed; hand the work to a child Agent.
New sentinel absent: yes; /tmp/loop-own/lc23/project/exit101-new.txt
Existing sentinel: /tmp/loop-own/lc23/project/exit101-existing.txt
Existing bytes before and after: "LC23 exit101 original bytes\n"
Existing SHA-256 before: f20e9ec31cc1c3cd2a058ca1337058960f2f6ded5c36ba021c465850bb9dbef3
Existing SHA-256 after:  f20e9ec31cc1c3cd2a058ca1337058960f2f6ded5c36ba021c465850bb9dbef3

SIGKILL after readiness; Write; tool id toolu_01HhdZSjqJneFHEf4sgnyb8B.
Vendor blocking reason verbatim:
PreToolUse:Write hook error: [if rup_memory_output=$(/tmp/loop-own/lc23/evidence/rup claude-memory /private/tmp/loop-own/lc23/data/memory /private/tmp/loop-own/lc23/project && printf '.'); then printf '%s' "${rup_memory_output%.}"; else printf '%s\n' 'Memory guard failed; hand the work to a child Agent.' >&2; exit 2; fi]: Memory guard failed; hand the work to a child Agent.
New sentinel absent: yes; /tmp/loop-own/lc23/project/sigkill-new.txt
Existing sentinel: /tmp/loop-own/lc23/project/sigkill-existing.txt
Existing bytes before and after: "LC23 sigkill original bytes\n"
Existing SHA-256 before: bc11fcdc10951e2d36325cc188732987ad79486a1dbe0b9062d43459c28e69dc
Existing SHA-256 after:  bc11fcdc10951e2d36325cc188732987ad79486a1dbe0b9062d43459c28e69dc
Readiness then SIGKILL: PID 39743; 1793614781378906000 -> 1793614781415251000 Unix nanoseconds; waiting hook shell was not killed.

SIGKILL after readiness; Edit; tool id toolu_01Tq1BvptjZ3FhUXCjrXAN8U.
Vendor blocking reason verbatim:
PreToolUse:Edit hook error: [if rup_memory_output=$(/tmp/loop-own/lc23/evidence/rup claude-memory /private/tmp/loop-own/lc23/data/memory /private/tmp/loop-own/lc23/project && printf '.'); then printf '%s' "${rup_memory_output%.}"; else printf '%s\n' 'Memory guard failed; hand the work to a child Agent.' >&2; exit 2; fi]: Memory guard failed; hand the work to a child Agent.
New sentinel absent: yes; /tmp/loop-own/lc23/project/sigkill-new.txt
Existing sentinel: /tmp/loop-own/lc23/project/sigkill-existing.txt
Existing bytes before and after: "LC23 sigkill original bytes\n"
Existing SHA-256 before: bc11fcdc10951e2d36325cc188732987ad79486a1dbe0b9062d43459c28e69dc
Existing SHA-256 after:  bc11fcdc10951e2d36325cc188732987ad79486a1dbe0b9062d43459c28e69dc
Readiness then SIGKILL: PID 39763; 1793614782892326000 -> 1793614782937999000 Unix nanoseconds; waiting hook shell was not killed.

Restored-program LC21: PASS.
Topic: /tmp/loop-own/lc23/data/memory/release-notes-concise.md
Saved fact: Write release notes for this isolated test Project in a concise form.
Updated fact: Write release notes for this isolated test Project in a detailed form.
Topic SHA-256 after save:   656736148bfdf1030eb79c5bbe189b5d32c1826654a423805c3fde83b023d953
Topic SHA-256 after update: 885834584f709b877a5fa6e6ea0d8d8343dd2093076e606d0bcdea8a1474830c
Index: /tmp/loop-own/lc23/data/memory/MEMORY.md.
Index bytes after save and update: "- [Release notes concise](release-notes-concise.md) — LC23 test Project: write concise release notes\n"
Index SHA-256 after save and update: b1070b3766524f82c4c561d9766a3c593fdf190671d9501195e57462578a7031
Index link resolves to the updated topic. Its label and summary still say concise.
Actual successful tool results: two Write calls saved the topic and index; three Edit calls updated the topic.
Restored outside-memory Edit refusal, verbatim:
PreToolUse:Edit hook error: /private/tmp/loop-own/lc23/project/restored-existing.txt is outside the Claude Code memory directory. Hand the work to a child Agent; only memory files may be written here.
Outside sentinel: /tmp/loop-own/lc23/project/restored-existing.txt.
Outside bytes before and after: "LC23 restored original bytes\n"
Outside SHA-256 before: bf5dedd5ac47dd81c3636f2a74f5d1149dd5228271752c93690e54ac91ff57ad
Outside SHA-256 after:  bf5dedd5ac47dd81c3636f2a74f5d1149dd5228271752c93690e54ac91ff57ad
Evidence: evidence/*-tool-results.json are vendor tool results from this Door, not its summary; before/after JSON files record filesystem bytes and hashes.
Memory bytes: evidence/memory-save.json, evidence/memory-update.json, and evidence/memory-before-update/.
Fixture readiness and kill records: evidence/fixture-*.json and evidence/killed-*.json.
No tracked PR files changed; nothing pushed. No desktop App or production binary was launched or replaced. No credentials or user settings were edited by the observer.
Cleanup: all observed test processes stopped by PID; none remain. Details: evidence/cleanup.json.

PR head c93fed796 merges main into the observed commit; `git diff 9f5a450f5b7e1beec61deb61141881e377882a02 c93fed796 -- crates/agents crates/rup crates/rupd` is empty, so the observed hook code is the head's. The `evidence/` files stayed on the observing Mac.
