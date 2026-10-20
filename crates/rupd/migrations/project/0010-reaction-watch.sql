-- NR2, NR4, NR5: where the evaluator stands on an Agents reaction: the Event cursor, the Agents seen
-- finished, whether it is armed, the last evidence and any recorded gap. One JSON `state` row each.
CREATE TABLE reaction_watch (
    reaction TEXT PRIMARY KEY NOT NULL REFERENCES reactions(id),
    state TEXT NOT NULL
);
