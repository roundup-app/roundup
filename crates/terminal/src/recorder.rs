//! R20's bounded opt-in recorder. Normal Terminals allocate no recording or sample history.
use super::*;
use contracts::terminal::KeystrokeSample;

pub(super) type Sample = Arc<Mutex<KeystrokeSample>>;

pub(super) fn clock() -> Arc<dyn Fn() -> f64 + Send + Sync> {
    let origin = std::time::Instant::now();
    Arc::new(move || origin.elapsed().as_secs_f64() * 1000.0)
}

pub(super) struct Recording {
    pub(super) run: String,
    marker: regex::bytes::Regex,
    samples: BTreeMap<String, Sample>,
    tail: Vec<u8>,
}

impl Recording {
    pub(super) fn new(run: &str) -> Result<Self, RpcError> {
        if run.is_empty()
            || run.len() > 64
            || !run.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(invalid("invalid keystroke run identity"));
        }
        let marker = regex::bytes::Regex::new(&format!("\x1b\\]777;{run}-[0-9]{{1,6}}\x07"))
            .map_err(RpcError::internal)?;
        Ok(Self {
            run: run.into(),
            marker,
            samples: BTreeMap::new(),
            tail: Vec::new(),
        })
    }

    pub(super) fn receive(&mut self, bytes: &[u8], received: f64) -> Result<Vec<Sample>, RpcError> {
        let mut queued = Vec::new();
        for found in self.marker.find_iter(bytes) {
            // The regexp accepts only ASCII, so every matched marker is UTF-8.
            let token = String::from_utf8(found.as_bytes().to_vec()).expect("ASCII marker");
            if self.samples.contains_key(&token) || self.samples.len() >= 4096 {
                return Err(RpcError::conflict(
                    "duplicate sample or keystroke recorder full",
                ));
            }
            let sample = Arc::new(Mutex::new(KeystrokeSample {
                token: token.clone(),
                received,
                written: None,
                read: None,
                ambiguous: false,
            }));
            self.samples.insert(token, Arc::clone(&sample));
            queued.push(sample);
        }
        Ok(queued)
    }

    pub(super) fn read(&mut self, bytes: &[u8], at: f64) {
        let previous = self.tail.len();
        self.tail.extend_from_slice(bytes);
        for found in self.marker.find_iter(&self.tail) {
            if found.end() <= previous {
                continue;
            }
            let token = std::str::from_utf8(found.as_bytes()).expect("ASCII marker");
            if let Some(sample) = self.samples.get(token) {
                let mut sample = sample.lock().expect("sample lock");
                if sample.read.is_some() {
                    sample.ambiguous = true;
                }
                sample.read = Some(at);
            }
        }
        // The longest accepted marker is shorter than 100 bytes; never retain program output.
        if self.tail.len() > 100 {
            self.tail.drain(..self.tail.len() - 100);
        }
    }

    pub(super) fn samples(&self) -> Vec<KeystrokeSample> {
        self.samples
            .values()
            .map(|sample| sample.lock().expect("sample lock").clone())
            .collect()
    }
}

#[cfg(test)]
#[path = "recorder_tests.rs"]
mod tests;
