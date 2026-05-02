use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub path: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn delete_files(paths: Vec<String>) -> Result<Vec<DeleteResult>, String> {
    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        results.push(do_delete(&path));
    }
    Ok(results)
}

fn do_delete(path: &str) -> DeleteResult {
    let p = Path::new(path);
    if !p.exists() {
        return DeleteResult {
            path: path.to_string(),
            ok: false,
            error: Some("Datei existiert nicht".to_string()),
        };
    }
    match trash::delete(p) {
        Ok(()) => DeleteResult {
            path: path.to_string(),
            ok: true,
            error: None,
        },
        Err(e) => DeleteResult {
            path: path.to_string(),
            ok: false,
            error: Some(e.to_string()),
        },
    }
}
