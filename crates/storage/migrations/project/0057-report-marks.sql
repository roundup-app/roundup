-- MC20: the high-water `seq` of each Agent's reports, kept so a Daemon restart still ignores a repeat.
CREATE TABLE report_marks (agent TEXT PRIMARY KEY, seq INTEGER NOT NULL);
