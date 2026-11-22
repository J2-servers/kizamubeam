//! Read the device profiles LightBurn keeps in its preferences (`prefs.ini`, a JSON file despite the name) for
//! "Import from LightBurn" in the devices dialog (src/lbdevices.ts). Read only: the file is never written, and only
//! `DeviceList` and `DefaultDevice` leave this module (prefs.ini also holds e-mail addresses, API auths and paths
//! of the LightBurn installation that the import does not need).

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightburnPrefs {
    /// The file that was read
    path: String,
    /// LightBurn `DeviceList` as stored (array of device objects)
    devices: serde_json::Value,
    /// LightBurn `DefaultDevice` (index into DeviceList, -1 = none)
    default_device: i64,
}

/// Where LightBurn keeps prefs.ini: Windows %LOCALAPPDATA%\LightBurn, macOS ~/Library/Preferences/LightBurn,
/// Linux ~/.local/share/LightBurn or ~/.config/LightBurn
fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(d) = dirs::data_local_dir() {
        out.push(d.join("LightBurn").join("prefs.ini"));
    }
    if let Some(d) = dirs::config_dir() {
        out.push(d.join("LightBurn").join("prefs.ini"));
    }
    if let Some(h) = dirs::home_dir() {
        out.push(h.join("Library").join("Preferences").join("LightBurn").join("prefs.ini"));
        out.push(h.join(".config").join("LightBurn").join("prefs.ini"));
        out.push(h.join(".local").join("share").join("LightBurn").join("prefs.ini"));
    }
    out.dedup();
    out
}

/// Devices from LightBurn's prefs.ini on this computer. Err carries the literal cause (file missing with the paths
/// that were tried, read error, JSON error, no DeviceList).
#[tauri::command]
pub fn lightburn_prefs_read() -> Result<LightburnPrefs, String> {
    let tried = candidates();
    let Some(path) = tried.iter().find(|p| p.is_file()) else {
        let list: Vec<String> = tried.iter().map(|p| p.display().to_string()).collect();
        return Err(format!("LightBurn prefs.ini not found. Looked in: {}", list.join("; ")));
    };
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let json: serde_json::Value =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("{}: {e}", path.display()))?;
    let devices = json.get("DeviceList").cloned().unwrap_or(serde_json::Value::Null);
    if !devices.is_array() {
        return Err(format!("{}: no DeviceList in the file", path.display()));
    }
    let default_device = json.get("DefaultDevice").and_then(|v| v.as_i64()).unwrap_or(-1);
    Ok(LightburnPrefs { path: path.display().to_string(), devices, default_device })
}
