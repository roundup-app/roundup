use std::{path::Path, process::Command, time::Instant};

fn shell(project: &Path, reference: &str) -> Result<Option<String>, String> {
    let output = Command::new("git").current_dir(project)
        .args(["show-ref", "--verify", "--hash", reference]).output().map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(Some(String::from_utf8_lossy(&output.stdout).trim().into()));
    }
    if output.status.code() == Some(1) { return Ok(None); }
    let fallback = Command::new("git").current_dir(project)
        .args(["for-each-ref", "--format=%(refname)", reference]).output().map_err(|e| e.to_string())?;
    if !fallback.status.success() { return Err(String::from_utf8_lossy(&fallback.stderr).into()); }
    if !String::from_utf8_lossy(&fallback.stdout).lines().any(|line| line == reference) { return Ok(None); }
    Err(String::from_utf8_lossy(&output.stderr).into())
}

fn gix_read(project: &Path, reference: &str) -> Result<Option<String>, String> {
    let repo = gix::open(project).map_err(|e| e.to_string())?;
    let reference = repo.try_find_reference(reference).map_err(|e| e.to_string())?;
    reference.map(|mut r| r.follow_to_object().map(|id| id.to_string()).map_err(|e| e.to_string())).transpose()
}

fn git2_read(project: &Path, reference: &str) -> Result<Option<String>, String> {
    let repo = git2::Repository::open(project).map_err(|e| e.to_string())?;
    match repo.refname_to_id(reference) {
        Ok(id) => Ok(Some(id.to_string())),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let project = Path::new(&args[2]);
    let readers = [("shell", shell as fn(&Path, &str) -> _), ("gix", gix_read), ("git2", git2_read)];
    if args[1] == "read" {
        for (name, read) in readers { println!("{name}: {:?}", read(project, &args[3])); }
        std::process::exit(if shell(project, &args[3]) == gix_read(project, &args[3]) { 0 } else { 1 });
    }
    println!("round,repository,reference,reader,elapsed_ns,result");
    for round in 0..11 {
        for (label, dir) in [("main", project.to_owned()), ("linked", project.parent().unwrap().join("linked"))] {
            for reference in ["refs/heads/main", "refs/heads/loose", "refs/heads/missing", "refs/roundup/provisioning/a/b"] {
                let expected = shell(&dir, reference);
                for offset in 0..3 {
                    let (name, read) = readers[(round + offset) % 3];
                    let start = Instant::now();
                    let result = read(&dir, reference);
                    let ns = start.elapsed().as_nanos();
                    println!("{round},{label},{reference},{name},{ns},{result:?}");
                    assert_eq!(result, expected, "{name} {label} {reference}");
                }
            }
        }
    }
}
