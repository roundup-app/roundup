CREATE TABLE message_inbox_last (
    receiver TEXT NOT NULL,
    session TEXT NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY(receiver, session)
);
