//! Fenster „Produkt erstellen“ (src/criar/): eine eigene Webansicht neben dem Hauptfenster, damit die KI-Arbeit
//! die Maschinensteuerung im Hauptfenster nie stört. Sie hat ein eigenes JavaScript und eine eigene Berechtigung
//! (capabilities/criar.json); die fertigen Teile kommen per Tauri-Ereignis ins Hauptfenster.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

const LABEL: &str = "criar";

/// Öffnet das Fenster oder holt es nach vorn, wenn es schon offen ist.
/// async: Fenster aus einem synchronen Befehl zu bauen blockiert unter Windows die Ereignisschleife.
#[tauri::command]
pub async fn open_criar_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        return w.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("criar.html".into()))
        .title("KizamuBeam — Crie seu produto")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 620.0)
        // Bilder per HTML5-Drag-and-drop in die Seite ziehen (die native Behandlung würde sie abfangen, #258)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hauptfenster nach vorn holen, nachdem es Teile aus dem Fenster „Produkt erstellen“ übernommen hat.
#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or_else(|| "Hauptfenster nicht gefunden".to_string())?;
    let _ = w.unminimize();
    let _ = w.show();
    w.set_focus().map_err(|e| e.to_string())
}

/// Seiten, auf denen man einen Schlüssel der unterstützten KI-Anbieter anlegt. Nur diese öffnet der Befehl.
const KEY_PAGES: [&str; 5] = [
    "https://openrouter.ai/",
    "https://platform.claude.com/",
    "https://console.anthropic.com/",
    "https://platform.openai.com/",
    "https://aistudio.google.com/",
];

/// Öffnet die Schlüssel-Seite eines KI-Anbieters im Standardbrowser.
#[tauri::command]
pub fn criar_open_key_page(url: String) -> Result<(), String> {
    if !KEY_PAGES.iter().any(|p| url.starts_with(p)) || url.chars().any(|c| c.is_whitespace() || c == '"' || c == '&' || c == '^') {
        return Err(format!("Adresse nicht erlaubt: {url}"));
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Schließt das Fenster „Produkt erstellen“, wenn das Hauptfenster geschlossen wurde.
pub fn close_with_main(window: &Window, event: &WindowEvent) {
    if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
        if let Some(w) = window.app_handle().get_webview_window(LABEL) {
            let _ = w.close();
        }
    }
}
