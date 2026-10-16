CREATE TABLE asks (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE TABLE ask_parts (
    ask TEXT NOT NULL REFERENCES asks(id),
    ord INTEGER NOT NULL CHECK (ord >= 0),
    text TEXT NOT NULL,
    placement TEXT NOT NULL CHECK (json_valid(placement)),
    state TEXT NOT NULL CHECK (state IN ('placing','waiting','queued','typed','failed','dropped')),
    reason TEXT,
    PRIMARY KEY (ask, ord)
);
