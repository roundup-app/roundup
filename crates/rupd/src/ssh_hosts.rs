//! MC73: the concrete `Host` names of the user's ssh config, for the Add dialog to offer.

use std::io::BufReader;
use std::path::Path;

use ssh2_config::{ParseRule, SshConfig};

/// The concrete `Host` names in the ssh config at `config`, in file order, without a `*`, `?` or
/// negated pattern and without a name in `taken`. A missing or unreadable file gives none. Reads
/// only; the user's own ssh config is the user's own path (P15).
pub fn ssh_hosts(config: &Path, taken: &[String]) -> Vec<String> {
    let Ok(file) = std::fs::File::open(config) else {
        return Vec::new();
    };
    let rules = ParseRule::ALLOW_UNKNOWN_FIELDS | ParseRule::ALLOW_UNSUPPORTED_FIELDS;
    let Ok(parsed) = SshConfig::default().parse(&mut BufReader::new(file), rules) else {
        return Vec::new();
    };
    let mut names: Vec<String> = Vec::new();
    for clause in parsed.get_hosts().iter().flat_map(|host| &host.pattern) {
        let name = &clause.pattern;
        let concrete = !clause.negated && !name.is_empty() && !name.contains(['*', '?', '!']);
        if concrete && !taken.contains(name) && !names.contains(name) {
            names.push(name.clone());
        }
    }
    names
}
