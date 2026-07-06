use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;

const MAX_TOOL_TURNS: u32 = 8;
const MAX_TOKENS: u32 = 4096;

// ------------------------------------------------------------------ wire types

/// Provider connection details as configured in Settings. `kind` selects
/// which adapter below handles the request; `base_url`/`auth_style`/
/// `api_version` only matter for `openai-compatible`, since Anthropic and
/// Gemini each have a single fixed endpoint shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConfig {
    pub kind: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub api_version: String,
    #[serde(default)]
    pub auth_style: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallData {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

/// One turn in the conversation. `role` is one of "user" / "assistant" /
/// "tool" (a system prompt is synthesized fresh per request from live
/// project/file context rather than stored as a message, so it never goes
/// stale across a long chat).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tool_calls: Vec<ToolCallData>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub provider: AiProviderConfig,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub active_file_path: Option<String>,
    #[serde(default)]
    pub active_file_content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCallEvent {
    name: String,
    arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolResultEvent {
    name: String,
    ok: bool,
    summary: String,
}

// ------------------------------------------------------------------ entry point

#[tauri::command]
pub async fn ai_send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AiChatRequest,
) -> Result<Vec<ChatMessage>, String> {
    let mut messages = request.messages;
    let system_prompt = build_system_prompt(
        &request.project_path,
        &request.active_file_path,
        &request.active_file_content,
    );
    let specs = tool_specs();
    let client = reqwest::Client::new();

    for _ in 0..MAX_TOOL_TURNS {
        let assistant_msg = match request.provider.kind.as_str() {
            "anthropic" => call_anthropic(&client, &request.provider, &system_prompt, &messages, &specs).await?,
            "gemini" => call_gemini(&client, &request.provider, &system_prompt, &messages, &specs).await?,
            _ => call_openai_compatible(&client, &request.provider, &system_prompt, &messages, &specs).await?,
        };
        let tool_calls = assistant_msg.tool_calls.clone();
        messages.push(assistant_msg);

        if tool_calls.is_empty() {
            return Ok(messages);
        }

        for call in &tool_calls {
            let _ = app.emit(
                "ai-tool-call",
                ToolCallEvent { name: call.name.clone(), arguments: call.arguments.clone() },
            );
            let result = execute_tool(&state, &request.project_path, &call.name, &call.arguments);
            let (ok, text) = match &result {
                Ok(s) => (true, s.clone()),
                Err(e) => (false, e.clone()),
            };
            let _ = app.emit(
                "ai-tool-result",
                ToolResultEvent { name: call.name.clone(), ok, summary: truncate_str(&text, 240) },
            );
            if ok && call.name == "write_file" {
                if let Some(path) = call.arguments.get("path").and_then(|v| v.as_str()) {
                    let _ = app.emit("ai-file-changed", path);
                }
            }
            messages.push(ChatMessage {
                role: "tool".to_string(),
                content: text,
                tool_call_id: Some(call.id.clone()),
                name: Some(call.name.clone()),
                ..Default::default()
            });
        }
    }

    messages.push(ChatMessage {
        role: "assistant".to_string(),
        content: format!(
            "Stopped after {MAX_TOOL_TURNS} tool calls in this turn — ask a follow-up to continue."
        ),
        ..Default::default()
    });
    Ok(messages)
}

fn build_system_prompt(
    project_path: &Option<String>,
    active_file_path: &Option<String>,
    active_file_content: &Option<String>,
) -> String {
    let mut prompt = String::from(
        "You are the AI assistant built into TestIDE, a desktop IDE for PlatformIO and ESP-IDF \
         embedded development. You can read and write files in the user's open project and read \
         recent serial monitor output via the tools provided. Prefer calling a tool over guessing \
         file contents. write_file replaces a file's entire contents, so when editing you must \
         include the complete new file content, not a diff or partial snippet. Be concise and \
         practical — this is embedded/firmware work, not general web development.",
    );
    if let Some(p) = project_path {
        prompt.push_str(&format!("\n\nCurrent project root: {p}"));
    }
    if let Some(path) = active_file_path {
        prompt.push_str(&format!("\n\nThe user currently has this file open in the editor: {path}"));
        if let Some(content) = active_file_content {
            prompt.push_str(&format!("\n\nIts current contents:\n```\n{}\n```", truncate_str(content, 8000)));
        }
    }
    prompt
}

// ------------------------------------------------------------------ tools

struct ToolSpec {
    name: &'static str,
    description: &'static str,
    parameters: serde_json::Value,
}

fn tool_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "read_file",
            description: "Read the full contents of a file in the project by path (relative to the project root, or absolute).",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "File path, relative to the project root or absolute" } },
                "required": ["path"]
            }),
        },
        ToolSpec {
            name: "write_file",
            description: "Create or overwrite a file in the project with the given contents. This replaces the ENTIRE file — always pass complete file contents.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path, relative to the project root or absolute" },
                    "contents": { "type": "string", "description": "The full new contents of the file" }
                },
                "required": ["path", "contents"]
            }),
        },
        ToolSpec {
            name: "list_files",
            description: "List files and folders in the project, optionally under a subdirectory.",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Subdirectory to list, relative to the project root. Omit to list the whole project." } }
            }),
        },
        ToolSpec {
            name: "read_serial_monitor",
            description: "Read the most recent lines captured from the device's serial monitor output, if it has been running.",
            parameters: json!({
                "type": "object",
                "properties": { "lines": { "type": "integer", "description": "How many recent lines to return (default 50, max 500)" } }
            }),
        },
    ]
}

/// Lexically normalizes `..`/`.` components (without touching the
/// filesystem, since a target path may not exist yet) and rejects anything
/// that would still resolve outside the project root. Not a hardened
/// sandbox — this is a local single-user dev tool — but it stops an
/// unconstrained or prompt-injected tool call from wandering outside the
/// project by accident.
fn resolve_project_path(project_path: &Option<String>, raw: &str) -> Result<PathBuf, String> {
    let root = project_path.as_ref().ok_or_else(|| "No project is open".to_string())?;
    let root_path = normalize_lexically(Path::new(root));
    let raw_path = Path::new(raw);
    let candidate = if raw_path.is_absolute() { raw_path.to_path_buf() } else { root_path.join(raw_path) };
    let normalized = normalize_lexically(&candidate);

    if !normalized.starts_with(&root_path) {
        return Err("Refusing to access a path outside the project directory".to_string());
    }
    Ok(normalized)
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn execute_tool(
    state: &State<AppState>,
    project_path: &Option<String>,
    name: &str,
    args: &serde_json::Value,
) -> Result<String, String> {
    match name {
        "read_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            let resolved = resolve_project_path(project_path, path)?;
            crate::project::read_file(resolved.to_string_lossy().to_string())
        }
        "write_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path' argument")?;
            let contents = args.get("contents").and_then(|v| v.as_str()).ok_or("Missing 'contents' argument")?;
            let resolved = resolve_project_path(project_path, path)?;
            if let Some(parent) = resolved.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            crate::project::write_file(resolved.to_string_lossy().to_string(), contents.to_string())?;
            Ok(format!("Wrote {path} ({} bytes)", contents.len()))
        }
        "list_files" => {
            let sub = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let resolved = if sub.is_empty() {
                let root = project_path.as_ref().ok_or_else(|| "No project is open".to_string())?;
                PathBuf::from(root)
            } else {
                resolve_project_path(project_path, sub)?
            };
            let tree = crate::project::read_project_tree(resolved.to_string_lossy().to_string())?;
            let mut out = String::new();
            flatten_tree(&tree, "", &mut out);
            if out.is_empty() {
                out.push_str("(empty directory)");
            }
            Ok(out)
        }
        "read_serial_monitor" => {
            let limit = args.get("lines").and_then(|v| v.as_u64()).unwrap_or(50).clamp(1, 500) as usize;
            let buf = state.monitor_buffer.lock().map_err(|_| "monitor buffer lock poisoned")?;
            if buf.is_empty() {
                return Ok("The serial monitor has no captured output yet (not running, or no data received).".to_string());
            }
            let mut lines: Vec<String> = buf.iter().rev().take(limit).cloned().collect();
            lines.reverse();
            Ok(lines.join("\n"))
        }
        other => Err(format!("Unknown tool: {other}")),
    }
}

fn flatten_tree(nodes: &[crate::project::FileNode], prefix: &str, out: &mut String) {
    for node in nodes {
        out.push_str(prefix);
        out.push_str(&node.name);
        if node.is_dir {
            out.push('/');
        }
        out.push('\n');
        if let Some(children) = &node.children {
            flatten_tree(children, &format!("{prefix}  "), out);
        }
    }
}

// ------------------------------------------------------------------ helpers

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    match s.char_indices().nth(max) {
        Some((idx, _)) => format!("{}…", &s[..idx]),
        None => s.to_string(),
    }
}

fn extract_error_message(body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(msg) = v.pointer("/error/message").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
        if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    truncate_str(body.trim(), 400)
}

// ------------------------------------------------------------------ Anthropic

async fn call_anthropic(
    client: &reqwest::Client,
    provider: &AiProviderConfig,
    system_prompt: &str,
    messages: &[ChatMessage],
    specs: &[ToolSpec],
) -> Result<ChatMessage, String> {
    let mut wire_messages = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "user" => wire_messages.push(json!({
                "role": "user",
                "content": [{"type": "text", "text": m.content}]
            })),
            "assistant" => {
                let mut content = Vec::new();
                if !m.content.is_empty() {
                    content.push(json!({"type": "text", "text": m.content}));
                }
                for tc in &m.tool_calls {
                    content.push(json!({"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.arguments}));
                }
                wire_messages.push(json!({"role": "assistant", "content": content}));
            }
            "tool" => wire_messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                    "content": m.content,
                }]
            })),
            _ => {}
        }
    }

    let tools: Vec<_> = specs
        .iter()
        .map(|s| json!({"name": s.name, "description": s.description, "input_schema": s.parameters}))
        .collect();

    let body = json!({
        "model": provider.model,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt,
        "messages": wire_messages,
        "tools": tools,
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &provider.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read Anthropic response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Anthropic API error ({status}): {}", extract_error_message(&text)));
    }

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse Anthropic response: {e}"))?;

    let mut out_text = String::new();
    let mut tool_calls = Vec::new();
    if let Some(blocks) = value.get("content").and_then(|c| c.as_array()) {
        for block in blocks {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        out_text.push_str(t);
                    }
                }
                Some("tool_use") => {
                    tool_calls.push(ToolCallData {
                        id: block.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        name: block.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        arguments: block.get("input").cloned().unwrap_or(json!({})),
                    });
                }
                _ => {}
            }
        }
    }

    Ok(ChatMessage { role: "assistant".to_string(), content: out_text, tool_calls, ..Default::default() })
}

// ------------------------------------------------------------------ Gemini

async fn call_gemini(
    client: &reqwest::Client,
    provider: &AiProviderConfig,
    system_prompt: &str,
    messages: &[ChatMessage],
    specs: &[ToolSpec],
) -> Result<ChatMessage, String> {
    let mut contents = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "user" => contents.push(json!({"role": "user", "parts": [{"text": m.content}]})),
            "assistant" => {
                let mut parts = Vec::new();
                if !m.content.is_empty() {
                    parts.push(json!({"text": m.content}));
                }
                for tc in &m.tool_calls {
                    parts.push(json!({"functionCall": {"name": tc.name, "args": tc.arguments}}));
                }
                contents.push(json!({"role": "model", "parts": parts}));
            }
            "tool" => contents.push(json!({
                "role": "function",
                "parts": [{
                    "functionResponse": {
                        "name": m.name.clone().unwrap_or_default(),
                        "response": {"result": m.content},
                    }
                }]
            })),
            _ => {}
        }
    }

    let function_declarations: Vec<_> = specs
        .iter()
        .map(|s| json!({"name": s.name, "description": s.description, "parameters": s.parameters}))
        .collect();

    let model = provider.model.trim();
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");

    let body = json!({
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "tools": [{"functionDeclarations": function_declarations}],
    });

    let resp = client
        .post(&url)
        .header("x-goog-api-key", &provider.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read Gemini response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Gemini API error ({status}): {}", extract_error_message(&text)));
    }

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse Gemini response: {e}"))?;
    let parts = value
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .ok_or_else(|| format!("Unexpected Gemini response shape: {}", truncate_str(&text, 300)))?;

    let mut out_text = String::new();
    let mut tool_calls = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
            out_text.push_str(t);
        }
        if let Some(fc) = part.get("functionCall") {
            tool_calls.push(ToolCallData {
                id: format!("call_{i}"),
                name: fc.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                arguments: fc.get("args").cloned().unwrap_or(json!({})),
            });
        }
    }

    Ok(ChatMessage { role: "assistant".to_string(), content: out_text, tool_calls, ..Default::default() })
}

// ------------------------------------------------------- OpenAI-compatible

async fn call_openai_compatible(
    client: &reqwest::Client,
    provider: &AiProviderConfig,
    system_prompt: &str,
    messages: &[ChatMessage],
    specs: &[ToolSpec],
) -> Result<ChatMessage, String> {
    let mut wire_messages = vec![json!({"role": "system", "content": system_prompt})];
    for m in messages {
        match m.role.as_str() {
            "user" => wire_messages.push(json!({"role": "user", "content": m.content})),
            "assistant" => {
                let mut msg = json!({
                    "role": "assistant",
                    "content": if m.content.is_empty() { serde_json::Value::Null } else { json!(m.content) },
                });
                if !m.tool_calls.is_empty() {
                    let calls: Vec<_> = m
                        .tool_calls
                        .iter()
                        .map(|tc| {
                            json!({
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": serde_json::to_string(&tc.arguments).unwrap_or_default(),
                                }
                            })
                        })
                        .collect();
                    msg["tool_calls"] = json!(calls);
                }
                wire_messages.push(msg);
            }
            "tool" => wire_messages.push(json!({
                "role": "tool",
                "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content,
            })),
            _ => {}
        }
    }

    let tools: Vec<_> = specs
        .iter()
        .map(|s| json!({"type": "function", "function": {"name": s.name, "description": s.description, "parameters": s.parameters}}))
        .collect();

    let base = provider.base_url.trim_end_matches('/');
    let url = if provider.api_version.is_empty() {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/chat/completions?api-version={}", provider.api_version)
    };

    let mut req = client.post(&url).json(&json!({
        "model": provider.model,
        "messages": wire_messages,
        "tools": tools,
    }));
    req = if provider.auth_style == "api-key-header" {
        req.header("api-key", &provider.api_key)
    } else {
        req.header("Authorization", format!("Bearer {}", provider.api_key))
    };

    let resp = req.send().await.map_err(|e| format!("Request to {base} failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;
    if !status.is_success() {
        return Err(format!("API error ({status}): {}", extract_error_message(&text)));
    }

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse response: {e}"))?;
    let choice = value
        .pointer("/choices/0/message")
        .ok_or_else(|| format!("Unexpected response shape: {}", truncate_str(&text, 300)))?;

    let content = choice.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let mut tool_calls = Vec::new();
    if let Some(calls) = choice.get("tool_calls").and_then(|c| c.as_array()) {
        for call in calls {
            let args_str = call.pointer("/function/arguments").and_then(|v| v.as_str()).unwrap_or("{}");
            tool_calls.push(ToolCallData {
                id: call.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                name: call.pointer("/function/name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                arguments: serde_json::from_str(args_str).unwrap_or(json!({})),
            });
        }
    }

    Ok(ChatMessage { role: "assistant".to_string(), content, tool_calls, ..Default::default() })
}
