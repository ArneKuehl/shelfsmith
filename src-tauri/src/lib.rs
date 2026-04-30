mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::rename::rename_files,
            commands::scan::scan_directory,
            commands::scan::read_epub_metadata,
            commands::scan::read_pdf_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
