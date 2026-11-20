-- G11: the Agent's Worktree is the user's own, adopted in place; nothing deletes it (G12).
ALTER TABLE nodes ADD COLUMN worktree_adopted INTEGER NOT NULL DEFAULT 0;
