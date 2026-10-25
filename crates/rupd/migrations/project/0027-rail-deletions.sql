CREATE TABLE IF NOT EXISTS rail_deletions (
 operation TEXT PRIMARY KEY NOT NULL,
 actor TEXT NOT NULL,
 node TEXT NOT NULL,
 record TEXT NOT NULL,
 graph BLOB NOT NULL,
 boundary TEXT NOT NULL,
 restored INTEGER NOT NULL DEFAULT 0 CHECK(restored IN (0,1))
);
CREATE TABLE IF NOT EXISTS rail_removal_items (
 operation TEXT NOT NULL,
 kind TEXT NOT NULL,
 id TEXT NOT NULL,
 home TEXT,
 owner TEXT,
 incarnation TEXT,
 participant TEXT,
 PRIMARY KEY(operation,kind,id)
);
