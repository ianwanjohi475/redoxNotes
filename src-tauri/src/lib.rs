//! Native side of Redox Notes.
//!
//! Every note / report / whiteboard is stored as its own small JSON file in
//! `Documents\RedoxNotes\notes`, so your data is plain files you can back up,
//! sync (OneDrive, Google Drive…) or copy to another PC.

use base64::Engine;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("RedoxNotes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root_dir(app)?.join("notes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid note id: {id}"))
    }
}

/// Write atomically: write to a temp file, then rename over the target, so a
/// crash or power cut never leaves a half-written note behind.
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_all(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let dir = notes_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                out.push(value);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn save_doc(app: AppHandle, id: String, json: String) -> Result<(), String> {
    check_id(&id)?;
    let path = notes_dir(&app)?.join(format!("{id}.json"));
    write_atomic(&path, json.as_bytes())
}

#[tauri::command]
fn delete_doc(app: AppHandle, id: String) -> Result<(), String> {
    check_id(&id)?;
    let path = notes_dir(&app)?.join(format!("{id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = root_dir(&app)?.join("settings.json");
    Ok(fs::read_to_string(path).ok())
}

#[tauri::command]
fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    let path = root_dir(&app)?.join("settings.json");
    write_atomic(&path, json.as_bytes())
}

#[tauri::command]
fn data_location(app: AppHandle) -> Result<String, String> {
    Ok(root_dir(&app)?.display().to_string())
}

#[tauri::command]
fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = root_dir(&app)?;
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Shows a native "Save as" dialog and writes the given (base64) bytes.
/// Returns the chosen path, or None if the user cancelled.
#[tauri::command]
async fn export_file(
    app: AppHandle,
    default_name: String,
    filter_name: String,
    ext: String,
    b64: String,
) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &[ext.as_str()]);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Opens a file the user just exported (e.g. the .docx in Word).
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&path).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_all,
            save_doc,
            delete_doc,
            load_settings,
            save_settings,
            data_location,
            open_data_folder,
            export_file,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Redox Notes");
}
