//! Project-owned attribution and replay positions share the existing Rail transaction owner.
use super::*;
use crate::measurement::{Batch, Contribution, Position};
use contracts::project::{Measurement, MeasurementSource, Measurements};
use std::collections::HashMap;

struct Owner {
    agent: String,
    source: String,
    cwd: String,
    attempt: Option<String>,
    home: Option<String>,
    maker: String,
}

impl Rail {
    pub(crate) fn claim_measurement_observer(&mut self) -> bool {
        !std::mem::replace(&mut self.measurement_observing, true)
    }
    pub(crate) fn observe_measurement_owner(
        &mut self,
        id: &str,
        source: &str,
        cwd: &str,
        attempt: &str,
    ) {
        // Collection failure must not turn a successful conversation acknowledgement into
        // an Agent failure. The public read retains the cause while source collection retries.
        self.measurement_failure = self
            .retain_measurement_owner(id, source, cwd, Some(attempt))
            .err()
            .map(|e| e.message);
    }

    pub(crate) fn retain_measurement_owner(
        &self,
        agent: &str,
        source: &str,
        cwd: &str,
        attempt: Option<&str>,
    ) -> Result<(), RpcError> {
        let tree = self.tree()?;
        let node = find(&tree, agent)?;
        let home = home(&tree, agent);
        self.db.execute("INSERT INTO measurement_owners(agent,source,cwd,attempt,home,maker) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(agent,source) DO UPDATE SET attempt=excluded.attempt,cwd=excluded.cwd",params![agent,source,cwd,attempt,home,node.name]).map_err(sql)?;
        if let Some(attempt) = attempt {
            self.db.execute("INSERT OR IGNORE INTO measurement_attempts(agent,source,attempt) VALUES(?1,?2,?3)",params![agent,source,attempt]).map_err(sql)?;
        }
        Ok(())
    }

    pub(crate) fn measurement_revision(&self) -> Result<String, RpcError> {
        self.db
            .query_row("SELECT revision FROM measurement_state", [], |r| {
                r.get::<_, i64>(0)
            })
            .map(|r| r.to_string())
            .map_err(sql)
    }

    pub(crate) fn collect_measurements(&mut self, launcher: &crate::Launcher, now: i64) {
        self.measurement_failure = self.collect_sources(launcher, now).err().map(|e| e.message);
    }

    fn collect_sources(&mut self, launcher: &crate::Launcher, now: i64) -> Result<(), RpcError> {
        let before = self.db.total_changes();
        let tree = self.tree()?;
        let mut claims: HashMap<String, Vec<String>> = HashMap::new();
        // Recover known local sources for previously saved Agents; Attempt remains unknown.
        for node in &tree {
            if let Some((source, cwd)) = self.conversation(&node.id)? {
                claims
                    .entry(source.clone())
                    .or_default()
                    .push(node.id.clone());
                let exists = self
                    .db
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM measurement_owners WHERE source=?1)",
                        [&source],
                        |r| r.get::<_, bool>(0),
                    )
                    .map_err(sql)?;
                if !exists {
                    self.retain_measurement_owner(&node.id, &source, &cwd, None)?;
                }
            }
        }
        let mut query=self.db.prepare("SELECT agent,source,cwd,attempt,home,maker FROM measurement_owners WHERE disabled=0 AND unresolved=0").map_err(sql)?;
        let owners = query
            .query_map([], |r| {
                Ok(Owner {
                    agent: r.get(0)?,
                    source: r.get(1)?,
                    cwd: r.get(2)?,
                    attempt: r.get(3)?,
                    home: r.get(4)?,
                    maker: r.get(5)?,
                })
            })
            .map_err(sql)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql)?;
        drop(query);
        for mut owner in owners {
            if claims
                .get(&owner.source)
                .is_some_and(|agents| agents.iter().any(|agent| agent != &owner.agent))
            {
                self.db.execute("INSERT INTO measurement_positions(source,file,position,cause) VALUES(?1,'ownership','{}','source ownership is ambiguous between Agents') ON CONFLICT(source,file) DO NOTHING",[&owner.source]).map_err(sql)?;
                self.db
                    .execute(
                        "UPDATE measurement_owners SET unresolved=1 WHERE source=?1",
                        [&owner.source],
                    )
                    .map_err(sql)?;
                continue;
            }
            self.db
                .execute(
                    "DELETE FROM measurement_positions WHERE source=?1 AND file='ownership'",
                    [&owner.source],
                )
                .map_err(sql)?;
            if let Some(node) = tree.iter().find(|n| n.id == owner.agent) {
                owner.home = home(&tree, &owner.agent);
                owner.maker = node.name.clone();
                self.db
                    .execute(
                        "UPDATE measurement_owners SET home=?1,maker=?2 WHERE source=?3 AND (home IS NOT ?1 OR maker IS NOT ?2)",
                        params![owner.home, owner.maker, owner.source],
                    )
                    .map_err(sql)?;
            }
            let mut query = self
                .db
                .prepare("SELECT file,position FROM measurement_positions WHERE source=?1")
                .map_err(sql)?;
            let positions = query
                .query_map([&owner.source], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(sql)?
                .map(|r| {
                    let (file, position) = r.map_err(sql)?;
                    Ok((
                        file,
                        serde_json::from_str::<Position>(&position).map_err(RpcError::internal)?,
                    ))
                })
                .collect::<Result<HashMap<_, _>, RpcError>>()?;
            drop(query);
            match launcher.collect_measurements(Path::new(&owner.cwd), &owner.source, &positions) {
                Ok(batches) => {
                    for batch in batches {
                        if let Err(error) = self.accept_batch(&owner, batch, now) {
                            if error.code != rpc::code::CONFLICT {
                                return Err(error);
                            }
                            self.db.execute("INSERT INTO measurement_positions(source,file,position,cause) VALUES(?1,'collection','{}',?2) ON CONFLICT(source,file) DO UPDATE SET cause=excluded.cause WHERE cause IS NOT excluded.cause",params![owner.source,error.message]).map_err(sql)?;
                        }
                    }
                }
                Err(cause) => {
                    self.db.execute("INSERT INTO measurement_positions(source,file,position,cause) VALUES(?1,'collection','{}',?2) ON CONFLICT(source,file) DO UPDATE SET cause=excluded.cause WHERE cause IS NOT excluded.cause",params![owner.source,cause]).map_err(sql)?;
                }
            }
        }
        if self.db.total_changes() != before {
            self.db
                .execute("UPDATE measurement_state SET revision=revision+1", [])
                .map_err(sql)?;
        }
        Ok(())
    }

    fn accept_batch(&mut self, owner: &Owner, batch: Batch, now: i64) -> Result<(), RpcError> {
        let position = serde_json::to_string(&batch.position).map_err(RpcError::internal)?;
        let same = self
            .db
            .query_row(
                "SELECT position=?2 FROM measurement_positions WHERE source=?1 AND file=?3",
                params![owner.source, position, batch.file],
                |r| r.get::<_, bool>(0),
            )
            .optional()
            .map_err(sql)?
            .unwrap_or(false);
        if same && batch.contributions.is_empty() && batch.cause.is_none() {
            return Ok(());
        }
        let tx = self.db.transaction().map_err(sql)?;
        for contribution in batch.contributions {
            accept(&tx, owner, contribution, None, now)?;
        }
        let position = serde_json::to_string(&batch.position).map_err(RpcError::internal)?;
        tx.execute("INSERT INTO measurement_positions(source,file,position,cause,last_good) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(source,file) DO UPDATE SET position=excluded.position,cause=excluded.cause,last_good=CASE WHEN excluded.cause IS NULL THEN excluded.last_good ELSE measurement_positions.last_good END",params![owner.source,batch.file,position,batch.cause,if batch.cause.is_none(){Some(now)}else{None}]).map_err(sql)?;
        tx.execute(
            "DELETE FROM measurement_positions WHERE source=?1 AND file='collection'",
            [&owner.source],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    pub(crate) fn record_interval_failure(&mut self, agent: &str, attempt: &str, cause: &str) {
        let save = || -> Result<(), RpcError> {
            let before = self.db.total_changes();
            self.db.execute("INSERT INTO measurement_positions(source,file,position,cause) SELECT source,'intervals','{}',?3 FROM measurement_attempts WHERE agent=?1 AND attempt=?2 ON CONFLICT(source,file) DO UPDATE SET cause=excluded.cause WHERE cause IS NOT excluded.cause",params![agent,attempt,cause]).map_err(sql)?;
            if self.db.total_changes() != before {
                self.db
                    .execute("UPDATE measurement_state SET revision=revision+1", [])
                    .map_err(sql)?;
            }
            Ok(())
        };
        self.measurement_failure = save().err().map(|e| e.message);
    }

    pub(crate) fn accept_intervals(
        &mut self,
        agent: &str,
        attempt: &str,
        source: &str,
        contributions: Vec<Contribution>,
        now: i64,
    ) -> Result<(), RpcError> {
        for node in self.tree()? {
            if node.id != agent
                && self
                    .conversation(&node.id)?
                    .is_some_and(|(held, _)| held == source)
            {
                return Err(RpcError::conflict("interval source ownership is ambiguous"));
            }
        }
        let owner=self.db.query_row("SELECT agent,source,cwd,attempt,home,maker FROM measurement_owners WHERE agent=?1 AND source=?3 AND disabled=0 AND unresolved=0 AND EXISTS(SELECT 1 FROM measurement_attempts WHERE agent=?1 AND source=?3 AND attempt=?2)",params![agent,attempt,source],|r|Ok(Owner {agent:r.get(0)?,source:r.get(1)?,cwd:r.get(2)?,attempt:r.get(3)?,home:r.get(4)?,maker:r.get(5)?})).optional().map_err(sql)?.ok_or_else(||RpcError::conflict("interval ownership is unresolved"))?;
        let tree = self.tree()?;
        let mut owner = owner;
        owner.attempt = Some(attempt.to_owned());
        if let Some(node) = tree.iter().find(|n| n.id == agent) {
            owner.home = home(&tree, agent);
            owner.maker = node.name.clone();
        }
        let tx = self.db.transaction().map_err(sql)?;
        let before = tx.total_changes();
        tx.execute("UPDATE measurement_positions SET cause=NULL WHERE source=?1 AND file='intervals' AND cause IS NOT NULL",[source]).map_err(sql)?;
        for contribution in contributions {
            accept(&tx, &owner, contribution, owner.attempt.as_deref(), now)?;
        }
        if tx.total_changes() != before {
            tx.execute("INSERT INTO measurement_positions(source,file,position,last_good) VALUES(?1,'intervals','{}',?2) ON CONFLICT(source,file) DO UPDATE SET last_good=excluded.last_good,cause=NULL",params![owner.source,now]).map_err(sql)?;
            tx.execute("UPDATE measurement_state SET revision=revision+1", [])
                .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    pub(crate) fn measurements(&mut self, project: &Path) -> Result<Measurements, RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let revision = tx
            .query_row("SELECT revision FROM measurement_state", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(sql)?
            .to_string();
        let contributions = {
            let mut query=tx.prepare("SELECT identity,source,source_revision,agent,COALESCE(attempt,(SELECT attempt FROM measurement_request_attempts a WHERE a.identity=measurement_revisions.identity)),home,maker,observed,value,coverage FROM measurement_revisions WHERE revision IN (SELECT MAX(revision) FROM measurement_revisions GROUP BY identity) ORDER BY identity").map_err(sql)?;
            let rows = query
                .query_map([], |r| {
                    Ok((
                        Measurement {
                            identity: r.get(0)?,
                            source: r.get(1)?,
                            source_revision: r.get(2)?,
                            agent: r.get(3)?,
                            attempt: r.get(4)?,
                            home: r.get(5)?,
                            maker: r.get(6)?,
                            observed: r.get(7)?,
                            value: contracts::project::MeasurementValue::Request {
                                usage: contracts::project::Consumed {
                                    input: None,
                                    output: None,
                                    cache_read: None,
                                    cache_write: None,
                                },
                            },
                            coverage: Vec::new(),
                        },
                        r.get::<_, String>(8)?,
                        r.get::<_, String>(9)?,
                    ))
                })
                .map_err(sql)?;
            rows.map(|r| {
                let (mut c, value, coverage) = r.map_err(sql)?;
                c.value = serde_json::from_str(&value).map_err(RpcError::internal)?;
                c.coverage = serde_json::from_str(&coverage).map_err(RpcError::internal)?;
                Ok(c)
            })
            .collect::<Result<Vec<_>, RpcError>>()?
        };
        let sources = {
            let mut query=tx.prepare("SELECT o.source,o.agent,MAX(p.last_good),GROUP_CONCAT(p.cause,'; ') FROM measurement_owners o LEFT JOIN measurement_positions p ON p.source=o.source WHERE o.disabled=0 GROUP BY o.source ORDER BY o.source").map_err(sql)?;
            query.query_map([],|r|Ok(MeasurementSource {source:r.get(0)?,agent:r.get(1)?,last_good:r.get(2)?,cause:r.get(3)?,coverage:vec!["completed local request records; earlier missing history uncovered; execution spans unavailable unless emitted to this Attempt's collector; human and coordination waits not collected".into()]})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?
        };
        tx.commit().map_err(sql)?;
        Ok(Measurements {
            project: project.to_string_lossy().into_owned(),
            cause: self.measurement_failure.clone(),
            revision,
            contributions,
            sources,
        })
    }
}

fn home(tree: &[RailNode], id: &str) -> Option<String> {
    let mut node = tree.iter().find(|n| n.id == id)?;
    loop {
        if node.kind == NodeKind::Workstream {
            return Some(node.id.clone());
        }
        node = tree.iter().find(|n| Some(&n.id) == node.parent.as_ref())?;
    }
}

fn accept(
    db: &Connection,
    owner: &Owner,
    contribution: Contribution,
    attempt: Option<&str>,
    now: i64,
) -> Result<(), RpcError> {
    if db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM measurement_erased WHERE identity=?1)",
            [&contribution.identity],
            |r| r.get::<_, bool>(0),
        )
        .map_err(sql)?
    {
        return Ok(());
    }
    if let (Some(identity), Some(attempt)) = (&contribution.related_request, attempt) {
        let same=db.query_row("SELECT agent=?2 AND source=?3 AND attempt=?4 FROM measurement_request_attempts WHERE identity=?1",params![identity,owner.agent,owner.source,attempt],|r|r.get::<_,bool>(0)).optional().map_err(sql)?;
        if same == Some(false) {
            return Err(RpcError::conflict("request Attempt attribution conflicts"));
        }
        db.execute("INSERT OR IGNORE INTO measurement_request_attempts(identity,agent,source,attempt) VALUES(?1,?2,?3,?4)",params![identity,owner.agent,owner.source,attempt]).map_err(sql)?;
    }
    let existing:Option<(String,Option<String>,String)>=db.query_row("SELECT agent,home,maker FROM measurement_revisions WHERE identity=?1 ORDER BY revision LIMIT 1",[&contribution.identity],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(sql)?;
    if existing
        .as_ref()
        .is_some_and(|(agent, _, _)| agent != &owner.agent)
    {
        return Err(RpcError::conflict(
            "measurement identity already belongs to another Agent",
        ));
    }
    let (home, maker) = existing
        .as_ref()
        .map_or((&owner.home, &owner.maker), |(_, home, maker)| {
            (home, maker)
        });
    db.execute("INSERT OR IGNORE INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![contribution.identity,contribution.revision,owner.source,owner.agent,attempt,home,maker,now,serde_json::to_string(&contribution.value).map_err(RpcError::internal)?,serde_json::to_string(&contribution.coverage).map_err(RpcError::internal)?]).map_err(sql)?;
    Ok(())
}
