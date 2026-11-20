use agents::worktree::{Git, Worktree};
use std::sync::atomic::AtomicBool;

#[test]
fn zz_measure() {
    let Ok(list) = std::env::var("MEASURE") else { return };
    let git = Git::from_env();
    let mut counts = vec![];
    for line in list.lines() {
        let (m, p1) = line.split_once(' ').unwrap();
        let path = std::path::PathBuf::from(format!("/tmp/measure/{m}"));
        std::process::Command::new("git").args(["worktree","add","--detach","-f",path.to_str().unwrap(),m]).output().unwrap();
        let w = Worktree { path: path.clone(), branch: "x".into(), base: p1.into(), adopted: false };
        let r = git.repeat_scan(&w, &AtomicBool::new(false));
        match r { Ok(h) => { println!("PR {m} hits={} complete={}", h.hits.len(), h.complete); for x in h.hits.iter().take(3) { println!("   {} {}-{} ~ {} {}-{}", x.path,x.start,x.end,x.other.path,x.other.start,x.other.end);} counts.push(h.hits.len()); } Err(e) => println!("PR {m} err {e:?}") }
        std::process::Command::new("git").args(["worktree","remove","--force",path.to_str().unwrap()]).output().unwrap();
    }
    counts.sort();
    println!("MEDIAN {}", counts[counts.len()/2]);
}
