use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(target_os = "linux")]
fn default_shortcut() -> String {
    "Super+C".into()
}
#[cfg(not(target_os = "linux"))]
fn default_shortcut() -> String {
    "Alt+C".into()
}

const DEFAULT_WORKSPACE_NAME: &str = "默认";
const DEFAULT_WORKSPACE_ICON: &str = "📋";

struct AppState {
    db: Mutex<Option<Connection>>,
}

fn db_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("smart-clip")
        .join("clips.db")
}

fn config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("smart-clip")
        .join("config.json")
}

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    shortcut: Option<String>,
}

fn load_config() -> AppConfig {
    let path = config_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(c) = serde_json::from_str::<AppConfig>(&data) {
            return c;
        }
    }
    AppConfig::default()
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
}

fn init_db() -> rusqlite::Result<Connection> {
    let path = db_path();
    if let Some(p) = path.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let conn = Connection::open(&path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            workspace_id INTEGER NOT NULL DEFAULT 1
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspaces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT '📋',
            bg_type TEXT NOT NULL DEFAULT 'default',
            bg_gradient TEXT,
            bg_image_url TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            read_only INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )?;
    let col_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clips') WHERE name='workspace_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if col_count == 0 {
        let _ = conn.execute("ALTER TABLE clips ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1", []);
    }
    let read_only_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('workspaces') WHERE name='read_only'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if read_only_count == 0 {
        let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0", []);
    }
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM workspaces", [], |row| row.get(0))?;
    if count == 0 {
        conn.execute(
            "INSERT INTO workspaces (id, name, description, icon, sort_order) VALUES (1, ?1, '', ?2, 0)",
            params![DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_ICON],
        )?;
    }
    Ok(conn)
}

#[derive(Serialize)]
struct Clip {
    id: i64,
    content: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
struct Workspace {
    id: i64,
    name: String,
    description: String,
    icon: String,
    bg_type: String,
    bg_gradient: Option<String>,
    bg_image_url: String,
    sort_order: i64,
    #[serde(default)]
    read_only: bool,
    created_at: String,
}

#[tauri::command]
fn get_workspaces(state: tauri::State<AppState>) -> Result<Vec<Workspace>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, icon, bg_type, bg_gradient, bg_image_url, sort_order, read_only, created_at
             FROM workspaces ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                icon: row.get(3)?,
                bg_type: row.get(4)?,
                bg_gradient: row.get(5)?,
                bg_image_url: row.get(6)?,
                sort_order: row.get(7)?,
                read_only: row.get::<_, i64>(8).unwrap_or(0) != 0,
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn get_workspace(id: i64, state: tauri::State<AppState>) -> Result<Option<Workspace>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let opt = conn
        .query_row(
            "SELECT id, name, description, icon, bg_type, bg_gradient, bg_image_url, sort_order, read_only, created_at
             FROM workspaces WHERE id = ?1",
            params![id],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    icon: row.get(3)?,
                    bg_type: row.get(4)?,
                    bg_gradient: row.get(5)?,
                    bg_image_url: row.get(6)?,
                    sort_order: row.get(7)?,
                    read_only: row.get::<_, i64>(8).unwrap_or(0) != 0,
                    created_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(opt)
}

#[tauri::command]
fn create_workspace(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    state: tauri::State<AppState>,
) -> Result<Workspace, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let desc = description.unwrap_or_default();
    let icon_str = icon.unwrap_or_else(|| DEFAULT_WORKSPACE_ICON.to_string());
    let max_order: Option<i64> = conn
        .query_row("SELECT MAX(sort_order) FROM workspaces", [], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let sort_order = max_order.unwrap_or(0) + 1;
    conn.execute(
        "INSERT INTO workspaces (name, description, icon, sort_order, read_only) VALUES (?1, ?2, ?3, ?4, 0)",
        params![name, desc, icon_str, sort_order],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    drop(guard);
    get_workspace(id, state).and_then(|w| w.ok_or_else(|| "Workspace not found".to_string()))
}

#[derive(Deserialize)]
struct UpdateWorkspaceInput {
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    bg_type: Option<String>,
    bg_gradient: Option<String>,
    bg_image_url: Option<String>,
    read_only: Option<bool>,
}

#[tauri::command]
fn update_workspace(
    id: i64,
    input: UpdateWorkspaceInput,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let current: Option<(String, String, String, String, Option<String>, String, i64)> = conn
        .query_row(
            "SELECT name, description, icon, bg_type, bg_gradient, bg_image_url, read_only FROM workspaces WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (name, desc, icon, bg_type, bg_gradient, bg_image_url, read_only) =
        current.ok_or("Workspace not found")?;
    let name = input.name.unwrap_or(name);
    let desc = input.description.unwrap_or(desc);
    let icon = input.icon.unwrap_or(icon);
    let bg_type = input.bg_type.unwrap_or(bg_type);
    let bg_gradient = input.bg_gradient.or(bg_gradient);
    let bg_image_url = input.bg_image_url.unwrap_or(bg_image_url);
    let read_only = input
        .read_only
        .map(|b| if b { 1i64 } else { 0 })
        .unwrap_or(read_only);
    conn.execute(
        "UPDATE workspaces SET name=?1, description=?2, icon=?3, bg_type=?4, bg_gradient=?5, bg_image_url=?6, read_only=?7 WHERE id=?8",
        params![name, desc, icon, bg_type, bg_gradient, bg_image_url, read_only, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_workspace(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    if id == 1 {
        return Err("Cannot delete default workspace".to_string());
    }
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    conn.execute("DELETE FROM clips WHERE workspace_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_clips(workspace_id: i64, state: tauri::State<AppState>) -> Result<Vec<Clip>, String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let mut stmt = conn
        .prepare("SELECT id, content, created_at FROM clips WHERE workspace_id = ?1 ORDER BY id DESC LIMIT 100")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![workspace_id], |row| {
            Ok(Clip {
                id: row.get(0)?,
                content: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn add_clip(
    content: String,
    workspace_id: i64,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let read_only: i64 = conn
        .query_row(
            "SELECT read_only FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if read_only != 0 {
        return Ok(());
    }
    let last: Option<String> = conn
        .query_row(
            "SELECT content FROM clips WHERE workspace_id = ?1 ORDER BY id DESC LIMIT 1",
            params![workspace_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if last.as_deref() == Some(content.as_str()) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO clips (content, workspace_id) VALUES (?1, ?2)",
        params![content, workspace_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_clip(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let read_only: i64 = conn
        .query_row(
            "SELECT w.read_only FROM clips c JOIN workspaces w ON c.workspace_id = w.id WHERE c.id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if read_only != 0 {
        return Err("Workspace is read-only".to_string());
    }
    conn.execute("DELETE FROM clips WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_clips(workspace_id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("DB not initialized")?;
    let read_only: i64 = conn
        .query_row(
            "SELECT read_only FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if read_only != 0 {
        return Err("Workspace is read-only".to_string());
    }
    conn.execute("DELETE FROM clips WHERE workspace_id = ?1", params![workspace_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_shortcut() -> String {
    let config = load_config();
    config
        .shortcut
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_shortcut)
}

#[tauri::command]
fn set_shortcut(shortcut: String) -> Result<(), String> {
    let s = shortcut.trim();
    if s.is_empty() {
        return Err("Shortcut cannot be empty".to_string());
    }
    let mut config = load_config();
    config.shortcut = Some(s.to_string());
    save_config(&config)
}

#[tauri::command]
fn toggle_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let w = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    if w.is_visible().map_err(|e| e.to_string())? {
        w.hide().map_err(|e| e.to_string())?;
    } else {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = match init_db() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("DB init error: {}", e);
            None
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState { db: Mutex::new(db) })
        .invoke_handler(tauri::generate_handler![
        get_workspaces,
        get_workspace,
        create_workspace,
        update_workspace,
        delete_workspace,
        get_clips,
        add_clip,
        delete_clip,
        clear_clips,
        get_shortcut,
        set_shortcut,
        toggle_main_window,
    ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running smart-clip");
}
