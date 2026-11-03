fn main() -> std::process::ExitCode {
    match desktop::run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        // run reports every failure to stderr before returning, and uses a native dialog
        // for Project refusals. Printing the boxed error would disclose plugin content.
        Err(_) => std::process::ExitCode::FAILURE,
    }
}
