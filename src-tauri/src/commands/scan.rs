use serde::Serialize;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

const ALLOWED_EXTS: &[&str] = &["epub", "pdf", "mobi", "azw3"];

#[tauri::command]
pub async fn scan_directory(path: String, recursive: bool) -> Result<Vec<String>, String> {
    let root = Path::new(&path);
    if !root.exists() {
        return Err(format!("Ordner existiert nicht: {path}"));
    }
    if !root.is_dir() {
        return Err(format!("Pfad ist kein Ordner: {path}"));
    }

    let max_depth = if recursive { usize::MAX } else { 1 };
    let mut out = Vec::new();
    for entry in WalkDir::new(root).max_depth(max_depth).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if let Some(ext) = entry.path().extension().and_then(|s| s.to_str()) {
            let lower = ext.to_ascii_lowercase();
            if ALLOWED_EXTS.contains(&lower.as_str()) {
                if let Some(p) = entry.path().to_str() {
                    out.push(p.to_string());
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

#[derive(Debug, Serialize, Default)]
pub struct EpubMeta {
    pub title: Option<String>,
    pub author: Option<String>,
    pub author_file_as: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f32>,
    pub isbn: Option<String>,
}

#[tauri::command]
pub async fn read_epub_metadata(path: String) -> Result<EpubMeta, String> {
    let file = std::fs::File::open(&path).map_err(|e| format!("EPUB öffnen: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("ZIP lesen: {e}"))?;

    // 1. Find OPF path via container.xml
    let opf_path = {
        let mut container = zip
            .by_name("META-INF/container.xml")
            .map_err(|e| format!("container.xml: {e}"))?;
        let mut s = String::new();
        container.read_to_string(&mut s).map_err(|e| format!("container.xml read: {e}"))?;
        find_opf_path(&s).ok_or_else(|| "OPF-Pfad nicht gefunden".to_string())?
    };

    // 2. Read OPF
    let opf_xml = {
        let mut f = zip
            .by_name(&opf_path)
            .map_err(|e| format!("OPF nicht gefunden ({opf_path}): {e}"))?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| format!("OPF read: {e}"))?;
        s
    };

    Ok(parse_opf(&opf_xml))
}

fn find_opf_path(container_xml: &str) -> Option<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(container_xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                if e.name().as_ref() == b"rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            return Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) => return None,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

fn parse_opf(xml: &str) -> EpubMeta {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut meta = EpubMeta::default();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    enum Capture {
        None,
        Title,
        Creator(Option<String>), // file_as attr
        Identifier(bool),        // is_isbn
    }
    let mut capture = Capture::None;
    let mut text_buf = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name();
                let local = local_name(name.as_ref());
                match local {
                    b"title" => {
                        capture = Capture::Title;
                        text_buf.clear();
                    }
                    b"creator" => {
                        let mut file_as: Option<String> = None;
                        let mut role_is_author = true;
                        for attr in e.attributes().flatten() {
                            let key = local_name(attr.key.as_ref());
                            if key == b"file-as" {
                                file_as = Some(String::from_utf8_lossy(&attr.value).to_string());
                            } else if key == b"role" {
                                let v = String::from_utf8_lossy(&attr.value).to_string();
                                role_is_author = v == "aut" || v.is_empty();
                            }
                        }
                        if role_is_author {
                            capture = Capture::Creator(file_as);
                            text_buf.clear();
                        }
                    }
                    b"identifier" => {
                        let mut is_isbn = false;
                        for attr in e.attributes().flatten() {
                            let v = String::from_utf8_lossy(&attr.value).to_lowercase();
                            if v.contains("isbn") {
                                is_isbn = true;
                            }
                        }
                        capture = Capture::Identifier(is_isbn);
                        text_buf.clear();
                    }
                    b"meta" => {
                        // OPF3-style: <meta property="...">value</meta>  (no series usually)
                        // OPF2-style (calibre): <meta name="calibre:series" content="..."/>
                        let mut name_attr: Option<String> = None;
                        let mut content_attr: Option<String> = None;
                        for attr in e.attributes().flatten() {
                            let key = local_name(attr.key.as_ref());
                            let val = String::from_utf8_lossy(&attr.value).to_string();
                            if key == b"name" {
                                name_attr = Some(val);
                            } else if key == b"content" {
                                content_attr = Some(val);
                            }
                        }
                        if let (Some(n), Some(c)) = (name_attr, content_attr) {
                            apply_calibre_meta(&n, &c, &mut meta);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let name = e.name();
                if local_name(name.as_ref()) == b"meta" {
                    let mut name_attr: Option<String> = None;
                    let mut content_attr: Option<String> = None;
                    for attr in e.attributes().flatten() {
                        let key = local_name(attr.key.as_ref());
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        if key == b"name" {
                            name_attr = Some(val);
                        } else if key == b"content" {
                            content_attr = Some(val);
                        }
                    }
                    if let (Some(n), Some(c)) = (name_attr, content_attr) {
                        apply_calibre_meta(&n, &c, &mut meta);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if !matches!(capture, Capture::None) {
                    if let Ok(s) = t.unescape() {
                        text_buf.push_str(&s);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name();
                let local = local_name(name.as_ref());
                match (&capture, local) {
                    (Capture::Title, b"title") => {
                        if meta.title.is_none() {
                            let v = text_buf.trim();
                            if !v.is_empty() {
                                meta.title = Some(v.to_string());
                            }
                        }
                        capture = Capture::None;
                    }
                    (Capture::Creator(file_as), b"creator") => {
                        if meta.author.is_none() {
                            let v = text_buf.trim();
                            if !v.is_empty() {
                                meta.author = Some(v.to_string());
                            }
                            if file_as.is_some() && meta.author_file_as.is_none() {
                                meta.author_file_as = file_as.clone();
                            }
                        }
                        capture = Capture::None;
                    }
                    (Capture::Identifier(is_isbn), b"identifier") => {
                        if *is_isbn && meta.isbn.is_none() {
                            let v = text_buf.trim().replace(['-', ' '], "");
                            if !v.is_empty() {
                                meta.isbn = Some(v);
                            }
                        }
                        capture = Capture::None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    meta
}

fn local_name(qname: &[u8]) -> &[u8] {
    if let Some(pos) = qname.iter().position(|&b| b == b':') {
        &qname[pos + 1..]
    } else {
        qname
    }
}

fn apply_calibre_meta(name: &str, content: &str, meta: &mut EpubMeta) {
    match name {
        "calibre:series" => {
            if !content.trim().is_empty() {
                meta.series = Some(content.trim().to_string());
            }
        }
        "calibre:series_index" => {
            if let Ok(v) = content.trim().parse::<f32>() {
                meta.series_index = Some(v);
            }
        }
        _ => {}
    }
}

#[derive(Debug, Serialize, Default)]
pub struct PdfMeta {
    pub title: Option<String>,
    pub author: Option<String>,
}

#[tauri::command]
pub async fn read_pdf_metadata(path: String) -> Result<PdfMeta, String> {
    let doc = lopdf::Document::load(&path).map_err(|e| format!("PDF lesen: {e}"))?;
    let mut out = PdfMeta::default();
    if let Ok(info_ref) = doc.trailer.get(b"Info") {
        if let Ok(id) = info_ref.as_reference() {
            if let Ok(obj) = doc.get_object(id) {
                if let Ok(dict) = obj.as_dict() {
                    out.title = dict.get(b"Title").ok().and_then(|o| pdf_string(o));
                    out.author = dict.get(b"Author").ok().and_then(|o| pdf_string(o));
                }
            }
        }
    }
    Ok(out)
}

fn pdf_string(obj: &lopdf::Object) -> Option<String> {
    match obj {
        lopdf::Object::String(bytes, _) => {
            // Try UTF-16 BE with BOM, then Latin-1
            if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
                let units: Vec<u16> = bytes[2..]
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                Some(String::from_utf16_lossy(&units).trim().to_string())
            } else {
                Some(
                    bytes
                        .iter()
                        .map(|&b| b as char)
                        .collect::<String>()
                        .trim()
                        .to_string(),
                )
            }
            .filter(|s: &String| !s.is_empty())
        }
        _ => None,
    }
}
