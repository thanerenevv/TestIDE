use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::state::SharedChild;

#[derive(Clone, Serialize)]
pub struct ProcLine {
    pub id: String,
    pub stream: &'static str,
    pub line: String,
}

#[derive(Clone, Serialize)]
pub struct ProcDone {
    pub id: String,
    pub success: bool,
    pub code: Option<i32>,
}

/// Spawns `cmd`, streams stdout/stderr line-by-line as `{line_event}` payloads,
/// and emits `{done_event}` with the exit status once the process ends.
/// Returns the shared child handle so the caller can register it for cancellation.
pub fn spawn_streaming(
    app: AppHandle,
    mut cmd: Command,
    id: String,
    line_event: &'static str,
    done_event: &'static str,
) -> Result<SharedChild, String> {
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child: Child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start process: {e}"))?;

    let stdout: ChildStdout = child.stdout.take().expect("stdout was piped");
    let stderr: ChildStderr = child.stderr.take().expect("stderr was piped");

    let shared: SharedChild = Arc::new(Mutex::new(child));

    let out_app = app.clone();
    let out_id = id.clone();
    let out_event = line_event;
    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = out_app.emit(
                out_event,
                ProcLine {
                    id: out_id.clone(),
                    stream: "stdout",
                    line,
                },
            );
        }
    });

    let err_app = app.clone();
    let err_id = id.clone();
    let err_event = line_event;
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = err_app.emit(
                err_event,
                ProcLine {
                    id: err_id.clone(),
                    stream: "stderr",
                    line,
                },
            );
        }
    });

    let wait_child = Arc::clone(&shared);
    let wait_app = app;
    let wait_id = id;
    thread::spawn(move || {
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();
        let status = wait_child.lock().unwrap().wait();
        let (success, code) = match status {
            Ok(s) => (s.success(), s.code()),
            Err(_) => (false, None),
        };
        let _ = wait_app.emit(
            done_event,
            ProcDone {
                id: wait_id,
                success,
                code,
            },
        );
    });

    Ok(shared)
}

pub fn kill_shared(child: &SharedChild) -> Result<(), String> {
    let mut guard = child.lock().map_err(|_| "process lock poisoned")?;
    guard.kill().map_err(|e| format!("Failed to stop process: {e}"))
}
