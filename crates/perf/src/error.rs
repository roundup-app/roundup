//! The one failure type of the perf library: what a gate, a machine class or an idle observation refuses.

/// Every message reads as it did when these were strings; `From<Error> for String` keeps the binaries' own string plumbing unchanged.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("no load figures recorded")]
    NoLoads,
    #[error("budget {0:?} has no measurement")]
    UnmeasuredBudget(String),
    #[error("machine class: {0} is missing")]
    MachineFieldMissing(&'static str),
    #[error("machine class: unsupported host {distro} {version} {arch}")]
    UnsupportedHost {
        distro: String,
        version: String,
        arch: String,
    },
    #[error("machine class: cpu model {0:?} is not a supported Builder model")]
    UnsupportedBuilder(String),
    #[error("machine class: {0}")]
    UnmatchedClass(Box<Unmatched>),
    #[error("machine class {0}: baseline provenance is missing")]
    MissingProvenance(String),
    #[error("machine class {key}: no measured baseline for {metric}")]
    MissingBaseline { key: String, metric: String },
    #[error("{0}")]
    IdleGuard(String),
    #[error("{0}")]
    Membership(String),
    #[error("{0}")]
    Footprint(String),
    #[error("{0}")]
    Top(String),
    #[error("{0}")]
    Evidence(String),
}

/// A host that fits no measured class, boxed so `Error` stays small in a `Result`.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error(
    "{distro} {version} {arch} {model:?} with online cpus {online}, {available} available, affinity {affinity} matches no measured class"
)]
pub struct Unmatched {
    pub distro: String,
    pub version: String,
    pub arch: String,
    pub model: String,
    pub online: String,
    pub available: usize,
    pub affinity: String,
}

impl From<Error> for String {
    fn from(error: Error) -> Self {
        error.to_string()
    }
}
