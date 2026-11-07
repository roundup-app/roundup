//! U3078: immutable evidence in the Project Message holder, separate from delivery status.
use crate::Error;
use contracts::message::{ResultAcceptance, ResultObservation, ResultReport};
use rusqlite::{OptionalExtension, params};

use crate::Messages;

/// Shared by standalone Message migrations and the Project migration sequence.
#[doc(hidden)]
pub const SCHEMA: &str = "
CREATE TABLE message_results (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    request_key TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE(agent, request_key)
);
CREATE TABLE message_result_facts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    report TEXT NOT NULL,
    kind TEXT NOT NULL,
    record TEXT NOT NULL,
    UNIQUE(report, kind, record)
);";

impl Messages {
    /// Append or reconcile an equal report retry. Conflicting keys never overwrite history.
    pub fn record_result(&self, mut report: ResultReport) -> Result<ResultReport, Error> {
        let mut store = self.store()?;
        store.atomically(|store| {
            let previous: Option<String> = store
                .db
                .query_row(
                    "SELECT record FROM message_results WHERE agent=? AND request_key=?",
                    params![report.request.id, report.request.key],
                    |r| r.get(0),
                )
                .optional()
                .map_err(Error::internal)?;
            if let Some(previous) = previous {
                let previous: ResultReport =
                    serde_json::from_str(&previous).map_err(Error::internal)?;
                if serde_json::to_value(&previous.request).map_err(Error::internal)?
                    != serde_json::to_value(&report.request).map_err(Error::internal)?
                    || previous.author != report.author
                    || previous.attempt != report.attempt
                {
                    return Err(Error::conflict(
                        "report key already names another result",
                    ));
                }
                return Ok(previous);
            }
            store
                .db
                .execute(
                    "INSERT INTO message_results(agent,request_key,record) VALUES(?,?,'')",
                    params![report.request.id, report.request.key],
                )
                .map_err(Error::internal)?;
            report.report = store.db.last_insert_rowid().to_string();
            store
                .db
                .execute(
                    "UPDATE message_results SET record=? WHERE seq=?",
                    params![
                        serde_json::to_string(&report).map_err(Error::internal)?,
                        report.report
                    ],
                )
                .map_err(Error::internal)?;
            Ok(report)
        })
    }

    /// Read retained reports in append order, never names or current paths.
    pub fn result_reports(&self, agent: &str) -> Result<Vec<ResultReport>, Error> {
        self.store()?
            .db
            .prepare("SELECT record FROM message_results WHERE agent=? ORDER BY seq")
            .map_err(Error::internal)?
            .query_map([agent], |r| r.get::<_, String>(0))
            .map_err(Error::internal)?
            .map(|r| {
                serde_json::from_str(&r.map_err(Error::internal)?).map_err(Error::internal)
            })
            .collect()
    }

    /// Append exact-version acceptance; repeating an identical fact does not duplicate it.
    pub fn accept_result(
        &self,
        report: &str,
        acceptance: &ResultAcceptance,
    ) -> Result<(), Error> {
        self.result_fact(report, "acceptance", acceptance)
    }

    /// Only the Daemon's source observer calls this operation; no RPC payload carries a verdict.
    pub fn observe_result(
        &self,
        report: &str,
        observation: &ResultObservation,
    ) -> Result<(), Error> {
        self.result_fact(report, "observation", observation)
    }

    fn result_fact(
        &self,
        report: &str,
        kind: &str,
        record: &impl serde::Serialize,
    ) -> Result<(), Error> {
        self.store()?
            .db
            .execute(
                "INSERT OR IGNORE INTO message_result_facts(report,kind,record) VALUES(?,?,?)",
                params![
                    report,
                    kind,
                    serde_json::to_string(record).map_err(Error::internal)?
                ],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub fn result_acceptances(&self, report: &str) -> Result<Vec<ResultAcceptance>, Error> {
        self.result_facts(report, "acceptance")
    }

    pub fn result_observations(&self, report: &str) -> Result<Vec<ResultObservation>, Error> {
        self.result_facts(report, "observation")
    }

    fn result_facts<T: serde::de::DeserializeOwned>(
        &self,
        report: &str,
        kind: &str,
    ) -> Result<Vec<T>, Error> {
        self.store()?
            .db
            .prepare(
                "SELECT record FROM message_result_facts WHERE report=? AND kind=? ORDER BY seq",
            )
            .map_err(Error::internal)?
            .query_map(params![report, kind], |r| r.get::<_, String>(0))
            .map_err(Error::internal)?
            .map(|r| {
                serde_json::from_str(&r.map_err(Error::internal)?).map_err(Error::internal)
            })
            .collect()
    }
}
