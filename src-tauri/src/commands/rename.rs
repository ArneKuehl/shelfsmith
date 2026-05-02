use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct RenamePair {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize)]
pub struct RenameResult {
    pub from: String,
    pub to: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn rename_files(pairs: Vec<RenamePair>) -> Result<Vec<RenameResult>, String> {
    let mut results = Vec::with_capacity(pairs.len());
    for pair in pairs {
        results.push(do_rename(&pair));
    }
    Ok(results)
}

fn do_rename(pair: &RenamePair) -> RenameResult {
    let from = Path::new(&pair.from);
    let to = Path::new(&pair.to);

    if !from.exists() {
        return err(pair, "Quelldatei existiert nicht");
    }
    if pair.from == pair.to {
        return ok(pair);
    }
    // Zieldatei darf nicht existieren — außer die Pfade unterscheiden sich nur in der
    // Groß-/Kleinschreibung (case-insensitive Filesysteme wie macOS HFS+/APFS default).
    if to.exists() && !same_path_case_insensitive(&pair.from, &pair.to) {
        return err(pair, "Zieldatei existiert bereits");
    }
    if let Some(parent) = to.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return err(pair, &format!("Zielordner konnte nicht angelegt werden: {e}"));
            }
        }
    }
    match std::fs::rename(from, to) {
        Ok(()) => ok(pair),
        Err(e) if is_cross_device(&e) => match std::fs::copy(from, to) {
            Ok(_) => match std::fs::remove_file(from) {
                Ok(()) => ok(pair),
                Err(e) => err(pair, &format!("Quelle nach Kopie nicht löschbar: {e}")),
            },
            Err(e) => err(pair, &e.to_string()),
        },
        Err(e) => err(pair, &e.to_string()),
    }
}

fn is_cross_device(e: &std::io::Error) -> bool {
    e.raw_os_error() == Some(18)
}

fn ok(pair: &RenamePair) -> RenameResult {
    RenameResult {
        from: pair.from.clone(),
        to: pair.to.clone(),
        ok: true,
        error: None,
    }
}

fn err(pair: &RenamePair, msg: &str) -> RenameResult {
    RenameResult {
        from: pair.from.clone(),
        to: pair.to.clone(),
        ok: false,
        error: Some(msg.to_string()),
    }
}

fn same_path_case_insensitive(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}
