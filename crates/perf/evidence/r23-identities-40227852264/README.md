# R23 native task and producer identities (#4120)

Investigation in progress. Archived executable hashes match all ten members in
#4110. Native local/remote scheduling entries resolve on both pins. The candidate
send entry is selected by exact file offset, separately from the inlined send+217
address. Named argument recovery is unsupported; retained disassembly and matching
Tokio 1.53.1 source establish the task-header/vtable identity access sequence.
Definitions alone supply no observed hit, timestamp or linearization point.
