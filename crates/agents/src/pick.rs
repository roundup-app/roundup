//! MC33: the Machine the Door starts an Agent on, chosen by free capacity.
use terminal::MachineLoad;

/// Terminals a Machine is counted to hold at once; free capacity is this minus its live ones.
const SLOTS: usize = 8;

/// The listed Machine with the most free capacity, this Mac (`None`) included and winning ties.
/// An unreachable Machine is skipped.
pub(crate) fn pick(load: &MachineLoad) -> Option<String> {
    let mut best = (None, SLOTS as isize - load.mac as isize);
    for (name, live) in &load.machines {
        let Some(live) = live else { continue };
        let free = SLOTS as isize - *live as isize;
        if free > best.1 {
            best = (Some(name.clone()), free);
        }
    }
    best.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(mac: usize, machines: &[(&str, Option<usize>)]) -> MachineLoad {
        MachineLoad {
            mac,
            machines: machines
                .iter()
                .map(|(n, l)| ((*n).to_owned(), *l))
                .collect(),
        }
    }

    #[test]
    fn mc33_pick_most_free_capacity_ties_to_this_mac() {
        let three = load(3, &[("a", Some(5)), ("b", Some(1)), ("c", Some(2))]);
        assert_eq!(pick(&three).as_deref(), Some("b"));
        assert_eq!(pick(&load(1, &[("a", Some(1))])), None);
        assert_eq!(pick(&load(0, &[])), None);
    }

    #[test]
    fn mc33_unreachable_machine_skipped() {
        let l = load(4, &[("best", None), ("next", Some(2))]);
        assert_eq!(pick(&l).as_deref(), Some("next"));
        assert_eq!(pick(&load(4, &[("best", None)])), None);
    }
}
