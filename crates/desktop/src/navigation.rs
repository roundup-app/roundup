//! The main window never leaves the App (`scenarios/pads.md` U6451a): a navigation to anything but the App's own page is refused, and a web or mail address goes to the default browser.

use tauri::{Runtime, Url, plugin::TauriPlugin};

use crate::open;

/// What the guard does with a navigation to `url`.
#[derive(Debug, PartialEq)]
pub(crate) enum Verdict {
    Allow,
    Refuse,
    /// Refuse, and hand the address to the default browser.
    Open(String),
}

/// The App's own pages: the bundled origin (`tauri://`, `tauri.localhost`, `about:blank`) and the dev server.
fn own_page(url: &Url, dev_port: u16) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost" | "127.0.0.1") => url.port() == Some(dev_port),
            _ => false,
        },
        _ => false,
    }
}

/// The dev server's port when no `ROUNDUP_DEV_PORT` sets one (`apps/desktop/vite.config.ts`).
pub(crate) const DEFAULT_DEV_PORT: u16 = 5173;

pub(crate) fn check(url: &Url, dev_port: u16) -> Verdict {
    if own_page(url, dev_port) {
        return Verdict::Allow;
    }
    match url.scheme() {
        "http" | "https" | "mailto" => Verdict::Open(url.to_string()),
        _ => Verdict::Refuse,
    }
}

pub(crate) fn plugin<R: Runtime>(dev_port: u16) -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(move |_, url| {
            match check(url, dev_port) {
                Verdict::Allow => return true,
                Verdict::Refuse => {}
                Verdict::Open(address) => {
                    // LaunchServices waits on the system; the event loop must not.
                    std::thread::spawn(move || {
                        let opened = open::check(open::Target::Url { url: address })
                            .and_then(|launch| open::launch(&launch, None));
                        if let Err(error) = opened {
                            crate::diagnostics::report("open link in the browser", &error.message);
                        }
                    });
                }
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn u6451a_navigation_guard_refuses_web_and_hands_it_to_the_opener() {
        for own in [
            "tauri://localhost/",
            "http://tauri.localhost/index.html",
            "http://localhost:5173/",
            "http://localhost:5173/?x=1#y",
        ] {
            assert_eq!(check(&url(own), 5173), Verdict::Allow, "{own}");
        }
        assert_eq!(check(&url("http://localhost:5180/"), 5180), Verdict::Allow);
        assert_eq!(
            check(&url("http://localhost:5173/"), 5180),
            Verdict::Open("http://localhost:5173/".into())
        );
        for web in [
            "https://example.com/a",
            "http://example.com",
            "mailto:a@b.co",
            "http://localhost:8080/",
        ] {
            assert_eq!(
                check(&url(web), 5173),
                Verdict::Open(url(web).to_string()),
                "{web}"
            );
        }
        for other in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com",
            "data:text/html,x",
        ] {
            assert_eq!(check(&url(other), 5173), Verdict::Refuse, "{other}");
        }
    }
}
