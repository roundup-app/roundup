---
description: Hand the settled work to a builder that takes your place, then end yourself
---

Hand the build phase over to a roundup builder, now that shaping has settled.

1. Write the settled Work order: a short title, the ask, what done looks like, and the limits the builder must keep. State only what was settled with the user; do not invent scope.
2. Put the detail a builder needs (decisions, files, constraints, how to check) in a Pad with `pad_create`. The builder reads that Pad; it gets no copy of this conversation.
3. Call `agent_handoff` once with the order and the Pad's name. The builder takes your place on the Rail, and you end after it is running.
4. If the call returns an error, say so to the user in one line and keep working; do not retry in a loop.

Run this on your own only when the user's words told you to hand over once you settle. Otherwise run it when the user types `/handoff`. $ARGUMENTS
