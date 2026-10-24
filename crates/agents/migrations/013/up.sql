-- U3566c: the Agent's published finishes, which no later Status replaces.
ALTER TABLE nodes ADD COLUMN finished INTEGER NOT NULL DEFAULT 0 CHECK (finished >= 0);
