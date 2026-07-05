use std::io::{Read, Write};
use std::thread;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

/// A single interactive shell session backed by a real pty, so that
/// full-screen / raw-mode programs (vim, htop, the `claude` CLI, ...) behave
/// exactly as they would in a system terminal.
pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Clone, Serialize)]
struct TerminalOutput {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit {
    id: String,
}

fn home_dir() -> Option<String> {
    std::env::var("HOME").ok()
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open a pseudo-terminal: {e}"))?;

    let mut builder = CommandBuilder::new_default_prog();
    builder.env("TERM", "xterm-256color");
    if let Some(dir) = cwd.filter(|d| !d.is_empty()).or_else(home_dir) {
        builder.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| format!("Failed to start shell: {e}"))?;
    // Drop our copy of the slave side once the child owns it — otherwise the
    // pty never sees EOF (and thus never reports the child as exited) since
    // our own fd would keep it open.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to open pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to open pty writer: {e}"))?;

    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
    };

    {
        let mut sessions = state
            .terminals
            .lock()
            .map_err(|_| "terminal lock poisoned")?;
        sessions.insert(id.clone(), session);
    }

    // Bytes are forwarded as base64 (rather than decoded to a Rust/JS
    // string) because a raw read can split a multi-byte UTF-8 sequence
    // across two chunks; xterm.js's own parser is byte-aware and handles
    // reassembly correctly once decoded back to a Uint8Array on the
    // frontend.
    let out_app = app.clone();
    let out_id = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = BASE64.encode(&buf[..n]);
                    if out_app
                        .emit(
                            "terminal-output",
                            TerminalOutput {
                                id: out_id.clone(),
                                data,
                            },
                        )
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
        let _ = out_app.emit("terminal-exit", TerminalExit { id: out_id });
    });

    Ok(())
}

#[tauri::command]
pub fn terminal_write(state: State<AppState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state
        .terminals
        .lock()
        .map_err(|_| "terminal lock poisoned")?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "terminal session not found".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to terminal: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {e}"))
}

#[tauri::command]
pub fn terminal_resize(
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .terminals
        .lock()
        .map_err(|_| "terminal lock poisoned")?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "terminal session not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {e}"))
}

#[tauri::command]
pub fn terminal_kill(state: State<AppState>, id: String) -> Result<(), String> {
    let mut sessions = state
        .terminals
        .lock()
        .map_err(|_| "terminal lock poisoned")?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}
