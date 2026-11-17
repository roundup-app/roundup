-- G11: a worktree the user made and an Agent was started in; nothing deletes its branch.
ALTER TABLE nodes ADD COLUMN worktree_adopted INTEGER NOT NULL DEFAULT 0;
