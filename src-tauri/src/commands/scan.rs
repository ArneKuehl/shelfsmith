use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
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

// ---------------------------------------------------------------------------
// Write EPUB metadata (OPF rewrite + ZIP rebuild)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct EpubMetaPatch {
    pub title: Option<String>,
    pub author: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f32>,
}

#[tauri::command]
pub async fn write_epub_metadata(path: String, patch: EpubMetaPatch) -> Result<(), String> {
    if !Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("epub"))
        .unwrap_or(false)
    {
        return Err("Nur EPUB-Dateien werden unterstützt".to_string());
    }

    // 1. Read OPF + path
    let (opf_path, opf_xml) = {
        let file = std::fs::File::open(&path).map_err(|e| format!("EPUB öffnen: {e}"))?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("ZIP lesen: {e}"))?;
        let opf_path = {
            let mut container = zip
                .by_name("META-INF/container.xml")
                .map_err(|e| format!("container.xml: {e}"))?;
            let mut s = String::new();
            container
                .read_to_string(&mut s)
                .map_err(|e| format!("container.xml read: {e}"))?;
            find_opf_path(&s).ok_or_else(|| "OPF-Pfad nicht gefunden".to_string())?
        };
        let opf_xml = {
            let mut f = zip
                .by_name(&opf_path)
                .map_err(|e| format!("OPF nicht gefunden ({opf_path}): {e}"))?;
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|e| format!("OPF read: {e}"))?;
            s
        };
        (opf_path, opf_xml)
    };

    // 2. Rewrite OPF
    let new_opf = rewrite_opf(&opf_xml, &patch).map_err(|e| format!("OPF rewrite: {e}"))?;

    // 3. Rebuild ZIP into <path>.tmp, then atomic rename
    let tmp_path = format!("{path}.tmp");
    let result = rebuild_zip(&path, &tmp_path, &opf_path, &new_opf);
    match result {
        Ok(()) => {
            std::fs::rename(&tmp_path, &path).map_err(|e| {
                let _ = std::fs::remove_file(&tmp_path);
                format!("Rename tmp → original: {e}")
            })?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(e)
        }
    }
}

fn rebuild_zip(src: &str, dst: &str, opf_path: &str, new_opf: &str) -> Result<(), String> {
    use zip::write::SimpleFileOptions;

    let src_file = std::fs::File::open(src).map_err(|e| format!("ZIP öffnen: {e}"))?;
    let mut archive = zip::ZipArchive::new(src_file).map_err(|e| format!("ZIP lesen: {e}"))?;

    let dst_file = std::fs::File::create(dst).map_err(|e| format!("Tmp anlegen: {e}"))?;
    let mut writer = zip::ZipWriter::new(dst_file);

    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP-Eintrag #{i}: {e}"))?;
        let name = entry.name().to_string();

        if name == opf_path {
            let options = SimpleFileOptions::default()
                .compression_method(entry.compression())
                .last_modified_time(entry.last_modified().unwrap_or_default());
            drop(entry);
            writer
                .start_file(&name, options)
                .map_err(|e| format!("OPF schreiben: {e}"))?;
            writer
                .write_all(new_opf.as_bytes())
                .map_err(|e| format!("OPF schreiben: {e}"))?;
        } else {
            writer
                .raw_copy_file(entry)
                .map_err(|e| format!("Datei kopieren ({name}): {e}"))?;
        }
    }

    writer.finish().map_err(|e| format!("ZIP abschließen: {e}"))?;
    Ok(())
}

fn rewrite_opf(xml: &str, patch: &EpubMetaPatch) -> Result<String, String> {
    use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
    use quick_xml::{Reader, Writer};
    use std::io::Cursor;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let mut buf = Vec::new();

    let mut title_done = patch.title.is_none();
    let mut creator_done = patch.author.is_none();
    let mut series_done = patch.series.is_none();
    let mut series_index_done = patch.series_index.is_none();

    // True while we're skipping the original text node we just replaced.
    let mut skip_next_text = false;
    // Depth-tracking so a nested <title> (in HTML inside content) is not touched.
    // OPF metadata is always inside <metadata> — only act there.
    let mut in_metadata = false;

    loop {
        let ev = reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("XML parse: {e}"))?;

        match ev {
            Event::Start(e) => {
                let local = local_name(e.name().as_ref()).to_vec();
                if local == b"metadata" {
                    in_metadata = true;
                    writer
                        .write_event(Event::Start(e.into_owned()))
                        .map_err(|e| e.to_string())?;
                    continue;
                }

                if in_metadata && local == b"title" && !title_done {
                    let new_title = patch.title.as_ref().unwrap();
                    writer
                        .write_event(Event::Start(e.into_owned()))
                        .map_err(|e| e.to_string())?;
                    writer
                        .write_event(Event::Text(BytesText::new(new_title)))
                        .map_err(|e| e.to_string())?;
                    title_done = true;
                    skip_next_text = true;
                    continue;
                }

                if in_metadata && local == b"creator" && !creator_done {
                    // Determine role: only replace primary author (role=aut or empty)
                    let mut role_aut = true;
                    for attr in e.attributes().flatten() {
                        if local_name(attr.key.as_ref()) == b"role" {
                            let v = String::from_utf8_lossy(&attr.value).to_string();
                            role_aut = v == "aut" || v.is_empty();
                        }
                    }
                    if role_aut {
                        let new_author = patch.author.as_ref().unwrap();
                        // Rebuild tag attrs: drop existing file-as, add new one with full name.
                        let qname = e.name();
                        let mut new_e = BytesStart::new(
                            String::from_utf8_lossy(qname.as_ref()).to_string(),
                        );
                        let mut file_as_key: Option<Vec<u8>> = None;
                        for attr in e.attributes().flatten() {
                            let key_full = attr.key.as_ref().to_vec();
                            if local_name(&key_full) == b"file-as" {
                                file_as_key = Some(key_full);
                                continue;
                            }
                            new_e.push_attribute((
                                std::str::from_utf8(&key_full).unwrap_or(""),
                                std::str::from_utf8(&attr.value).unwrap_or(""),
                            ));
                        }
                        // Reuse original file-as attribute key (preserves namespace prefix
                        // like "opf:file-as") or default to "opf:file-as".
                        let fa_key = file_as_key
                            .as_ref()
                            .map(|k| std::str::from_utf8(k).unwrap_or("opf:file-as").to_string())
                            .unwrap_or_else(|| "opf:file-as".to_string());
                        new_e.push_attribute((fa_key.as_str(), new_author.as_str()));

                        writer
                            .write_event(Event::Start(new_e))
                            .map_err(|e| e.to_string())?;
                        writer
                            .write_event(Event::Text(BytesText::new(new_author)))
                            .map_err(|e| e.to_string())?;
                        creator_done = true;
                        skip_next_text = true;
                        continue;
                    } else {
                        writer
                            .write_event(Event::Start(e.into_owned()))
                            .map_err(|e| e.to_string())?;
                        continue;
                    }
                }

                writer
                    .write_event(Event::Start(e.into_owned()))
                    .map_err(|e| e.to_string())?;
            }
            Event::Empty(e) => {
                let local = local_name(e.name().as_ref()).to_vec();
                if in_metadata && local == b"meta" {
                    let mut name_attr: Option<String> = None;
                    for attr in e.attributes().flatten() {
                        if local_name(attr.key.as_ref()) == b"name" {
                            name_attr =
                                Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                    if let Some(name_val) = name_attr.as_deref() {
                        if name_val == "calibre:series" && !series_done {
                            let new_content = patch.series.as_ref().unwrap();
                            writer
                                .write_event(Event::Empty(make_calibre_meta(
                                    "calibre:series",
                                    new_content,
                                )))
                                .map_err(|e| e.to_string())?;
                            series_done = true;
                            continue;
                        }
                        if name_val == "calibre:series_index" && !series_index_done {
                            let v = patch.series_index.unwrap();
                            let formatted = format_series_index(v);
                            writer
                                .write_event(Event::Empty(make_calibre_meta(
                                    "calibre:series_index",
                                    &formatted,
                                )))
                                .map_err(|e| e.to_string())?;
                            series_index_done = true;
                            continue;
                        }
                    }
                }
                writer
                    .write_event(Event::Empty(e.into_owned()))
                    .map_err(|e| e.to_string())?;
            }
            Event::Text(t) => {
                if skip_next_text {
                    skip_next_text = false;
                } else {
                    writer
                        .write_event(Event::Text(t.into_owned()))
                        .map_err(|e| e.to_string())?;
                }
            }
            Event::End(e) => {
                let local = local_name(e.name().as_ref()).to_vec();
                if local == b"metadata" {
                    // Insert any missing fields just before </metadata>.
                    if !title_done {
                        let title = patch.title.as_ref().unwrap();
                        writer
                            .write_event(Event::Start(BytesStart::new("dc:title")))
                            .map_err(|e| e.to_string())?;
                        writer
                            .write_event(Event::Text(BytesText::new(title)))
                            .map_err(|e| e.to_string())?;
                        writer
                            .write_event(Event::End(BytesEnd::new("dc:title")))
                            .map_err(|e| e.to_string())?;
                        title_done = true;
                    }
                    if !creator_done {
                        let author = patch.author.as_ref().unwrap();
                        let mut start = BytesStart::new("dc:creator");
                        start.push_attribute(("opf:role", "aut"));
                        start.push_attribute(("opf:file-as", author.as_str()));
                        writer
                            .write_event(Event::Start(start))
                            .map_err(|e| e.to_string())?;
                        writer
                            .write_event(Event::Text(BytesText::new(author)))
                            .map_err(|e| e.to_string())?;
                        writer
                            .write_event(Event::End(BytesEnd::new("dc:creator")))
                            .map_err(|e| e.to_string())?;
                        creator_done = true;
                    }
                    if !series_done {
                        let s = patch.series.as_ref().unwrap();
                        writer
                            .write_event(Event::Empty(make_calibre_meta("calibre:series", s)))
                            .map_err(|e| e.to_string())?;
                        series_done = true;
                    }
                    if !series_index_done {
                        let v = patch.series_index.unwrap();
                        let formatted = format_series_index(v);
                        writer
                            .write_event(Event::Empty(make_calibre_meta(
                                "calibre:series_index",
                                &formatted,
                            )))
                            .map_err(|e| e.to_string())?;
                        series_index_done = true;
                    }
                    in_metadata = false;
                }
                writer
                    .write_event(Event::End(e.into_owned()))
                    .map_err(|e| e.to_string())?;
            }
            Event::Eof => break,
            other => {
                writer
                    .write_event(other)
                    .map_err(|e| e.to_string())?;
            }
        }
        buf.clear();
    }

    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| format!("UTF-8: {e}"))
}

fn make_calibre_meta<'a>(name: &str, content: &str) -> quick_xml::events::BytesStart<'a> {
    let mut e = quick_xml::events::BytesStart::new("meta");
    e.push_attribute(("name", name));
    e.push_attribute(("content", content));
    e
}

fn format_series_index(v: f32) -> String {
    if (v - v.round()).abs() < 1e-4 {
        format!("{}", v.round() as i64)
    } else {
        // Drop trailing zeros while keeping decimal precision.
        let s = format!("{v}");
        s
    }
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
