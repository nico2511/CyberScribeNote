use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::fs_util::atomic_write;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_IMPORT_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const MAX_IMPORT_TEXT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<VaultEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

pub fn vault_root() -> Result<PathBuf, String> {
    let cfg = crate::commands::config::load_config();
    if let Some(custom) = cfg.vault_path.as_deref() {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                return Ok(path);
            }
            return Err("Le chemin du vault doit être absolu.".into());
        }
    }
    let base = dirs::document_dir().ok_or("Impossible de trouver le dossier Documents")?;
    Ok(base.join("CyberScribeNote").join("vault"))
}

/// Refuse `..`, chemins absolus et lettres de lecteur Windows.
pub fn is_safe_vault_relative(relative: &str) -> bool {
    if relative.is_empty() {
        return true;
    }
    let norm = relative.replace('\\', "/");
    if Path::new(&norm).is_absolute() {
        return false;
    }
    // Unix-style absolute (souvent non détecté comme absolu sous Windows)
    if norm.starts_with('/') {
        return false;
    }
    if norm.len() >= 2 && norm.as_bytes()[1] == b':' {
        return false;
    }
    !norm.split('/').any(|part| part == "..")
}

fn resolve_path(relative: &str) -> Result<PathBuf, String> {
    if !is_safe_vault_relative(relative) {
        return Err("Accès refusé : chemin hors du vault".into());
    }

    let root = vault_root()?;
    let candidate = root.join(relative);
    let normalized = candidate
        .canonicalize()
        .or_else(|_| {
            if candidate.exists() {
                Ok(candidate.clone())
            } else {
                candidate.parent().map(|p| p.to_path_buf()).ok_or_else(|| {
                    format!("Chemin parent introuvable pour {}", relative)
                })
            }
        })
        .map_err(|e| e.to_string())?;

    let root_canon = root.canonicalize().unwrap_or(root);
    if !normalized.starts_with(&root_canon) && normalized != root_canon {
        return Err("Accès refusé : chemin hors du vault".into());
    }
    Ok(candidate)
}

fn ensure_vault() -> Result<PathBuf, String> {
    let root = vault_root()?;
    fs::create_dir_all(root.join("media")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    // Pas de note Bienvenue forcée — splash UI au premier lancement.
    Ok(root)
}

/// Autorise le vault courant dans le protocole asset (vault custom hors Documents).
pub fn register_vault_asset_scope(app: &tauri::AppHandle) -> Result<(), String> {
    let root = ensure_vault()?;
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| format!("Impossible d'autoriser le vault dans le protocole asset : {e}"))
}

fn is_hidden_media_dir(name: &str, path: &Path, parent: &Path, root: &Path) -> bool {
    if name == ".history" {
        return true;
    }
    if name == "_media" && path.is_dir() {
        return true;
    }
    path.is_dir() && parent == root && (name == "assets" || name == "media")
}

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

fn require_md_extension(relative: &str) -> Result<(), String> {
    let norm = relative.replace('\\', "/");
    if !norm.to_lowercase().ends_with(".md") {
        return Err("Seuls les fichiers .md sont autorisés.".into());
    }
    Ok(())
}

fn validate_image_magic(bytes: &[u8], ext: &str) -> Result<(), String> {
    let ok = match ext {
        "png" => {
            bytes.len() >= 8
                && bytes[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        }
        "jpg" | "jpeg" => bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF],
        "gif" => {
            bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a")
        }
        "webp" => {
            bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        "bmp" => bytes.len() >= 2 && &bytes[0..2] == b"BM",
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err("Contenu d'image invalide (signature fichier)".into())
    }
}

fn validate_export_destination(destination: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(destination.trim());
    if !path.is_absolute() {
        return Err("La destination d'export doit être un chemin absolu.".into());
    }
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        != Some(true)
    {
        return Err("L'export doit être un fichier .md.".into());
    }
    let parent = path
        .parent()
        .ok_or("Destination d'export invalide.")?;
    if !parent.is_dir() {
        return Err("Le dossier de destination n'existe pas.".into());
    }
    Ok(path)
}

fn normalize_image_ext(source: &Path, fallback: &str) -> Result<String, String> {
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or(fallback)
        .to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Format d'image non supporté".into());
    }
    Ok(ext)
}

fn unique_image_name(ext: &str) -> String {
    format!(
        "img_{}.{}",
        chrono::Local::now().format("%Y%m%d_%H%M%S"),
        ext
    )
}

fn media_destination(
    root: &Path,
    note_path: Option<&str>,
    use_global_media: bool,
) -> Result<(PathBuf, String), String> {
    if use_global_media || note_path.is_none() {
        let media = root.join("media");
        fs::create_dir_all(&media).map_err(|e| e.to_string())?;
        return Ok((media, "media".into()));
    }

    let note = resolve_path(note_path.unwrap())?;
    let parent = note
        .parent()
        .ok_or("Impossible de déterminer le dossier de la note")?;
    let media = parent.join("_media");
    fs::create_dir_all(&media).map_err(|e| e.to_string())?;

    let rel_parent = parent
        .strip_prefix(root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let prefix = if rel_parent.is_empty() {
        "_media".to_string()
    } else {
        format!("{rel_parent}/_media")
    };

    Ok((media, prefix))
}

fn store_imported_bytes(
    root: &Path,
    bytes: &[u8],
    ext: &str,
    note_path: Option<&str>,
    use_global_media: bool,
) -> Result<String, String> {
    let (dest_dir, rel_prefix) = media_destination(root, note_path, use_global_media)?;
    let filename = unique_image_name(ext);
    let dest = dest_dir.join(&filename);
    atomic_write(&dest, bytes)?;

    if rel_prefix == "_media" {
        Ok(format!("_media/{filename}"))
    } else if rel_prefix == "media" {
        Ok(format!("media/{filename}"))
    } else {
        Ok(format!("{rel_prefix}/{filename}"))
    }
}

fn read_dir_recursive(dir: &Path, root: &Path) -> Result<Vec<VaultEntry>, String> {
    let mut entries: Vec<VaultEntry> = Vec::new();

    let read_dir = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if is_hidden_media_dir(&name, &path, dir, root) {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        if path.is_dir() {
            let children = read_dir_recursive(&path, root)?;
            entries.push(VaultEntry {
                name,
                path: relative,
                is_dir: true,
                children: Some(children),
            });
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            entries.push(VaultEntry {
                name,
                path: relative,
                is_dir: false,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Le nom ne peut pas être vide".into());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Le nom contient des caractères invalides".into());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn init_vault(app: tauri::AppHandle) -> Result<String, String> {
    let root = ensure_vault()?;
    register_vault_asset_scope(&app)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn default_vault_path() -> Result<String, String> {
    let base = dirs::document_dir().ok_or("Impossible de trouver le dossier Documents")?;
    Ok(base
        .join("CyberScribeNote")
        .join("vault")
        .to_string_lossy()
        .to_string())
}

/// Change le dossier vault (absolu). Crée le dossier s'il n'existe pas.
#[tauri::command]
pub fn set_vault_path(app: tauri::AppHandle, path: Option<String>) -> Result<String, String> {
    let mut cfg = crate::commands::config::load_config();
    match path {
        None => {
            cfg.vault_path = None;
        }
        Some(p) => {
            let trimmed = p.trim().to_string();
            if trimmed.is_empty() {
                cfg.vault_path = None;
            } else {
                let pb = PathBuf::from(&trimmed);
                if !pb.is_absolute() {
                    return Err("Le chemin du vault doit être absolu.".into());
                }
                fs::create_dir_all(&pb).map_err(|e| format!("Impossible de créer le dossier : {e}"))?;
                // Vérifie qu'on peut écrire
                let probe = pb.join(".cyberscribe-write-test");
                fs::write(&probe, b"ok").map_err(|e| format!("Dossier non accessible en écriture : {e}"))?;
                let _ = fs::remove_file(&probe);
                cfg.vault_path = Some(trimmed);
            }
        }
    }
    crate::commands::config::save_app_config(cfg)?;
    let root = ensure_vault()?;
    register_vault_asset_scope(&app)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_vault() -> Result<Vec<VaultEntry>, String> {
    let root = ensure_vault()?;
    read_dir_recursive(&root, &root)
}

#[tauri::command]
pub fn read_note(relative_path: String) -> Result<String, String> {
    require_md_extension(&relative_path)?;
    let path = resolve_path(&relative_path)?;
    if !path.is_file() {
        return Err("Ce n'est pas un fichier".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note(relative_path: String, content: String) -> Result<(), String> {
    require_md_extension(&relative_path)?;
    let root = ensure_vault()?;
    let path = resolve_path(&relative_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let cfg = crate::commands::config::load_config();
    if cfg.note_history_enabled && path.is_file() {
        if let Ok(prev) = fs::read_to_string(&path) {
            if prev != content {
                let _ = push_note_snapshot(&root, &relative_path, &prev, cfg.note_history_max);
            }
        }
    }

    atomic_write(&path, content.as_bytes())
}

fn history_key(relative: &str) -> String {
    relative.replace('\\', "/").replace('/', "__")
}

fn history_dir(root: &Path, relative: &str) -> PathBuf {
    root.join(".history").join(history_key(relative))
}

fn push_note_snapshot(
    root: &Path,
    relative: &str,
    content: &str,
    max_versions: u32,
) -> Result<(), String> {
    let dir = history_dir(root, relative);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = format!(
        "{}-{:03}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        chrono::Local::now().timestamp_subsec_millis() % 1000
    );
    let file = dir.join(format!("{stamp}.md"));
    atomic_write(&file, content.as_bytes())?;

    let max = max_versions.max(1) as usize;
    let mut versions: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("md"))
        .collect();
    versions.sort();
    while versions.len() > max {
        if let Some(old) = versions.first() {
            let _ = fs::remove_file(old);
            versions.remove(0);
        } else {
            break;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub id: String,
    pub label: String,
    pub bytes: u64,
}

#[tauri::command]
pub fn list_note_history(relative_path: String) -> Result<Vec<NoteHistoryEntry>, String> {
    let root = ensure_vault()?;
    let dir = history_dir(&root, &relative_path);
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let id = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let label = format_history_label(&id);
        out.push(NoteHistoryEntry { id, label, bytes });
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

fn format_history_label(id: &str) -> String {
    // 20260907-081530-123 → 07/09/2026 08:15:30
    let parts: Vec<_> = id.split('-').collect();
    if parts.len() >= 2 && parts[0].len() == 8 && parts[1].len() >= 6 {
        let d = parts[0];
        let t = &parts[1][..6];
        return format!(
            "{}/{}/{} {}:{}:{}",
            &d[6..8],
            &d[4..6],
            &d[0..4],
            &t[0..2],
            &t[2..4],
            &t[4..6]
        );
    }
    id.to_string()
}

#[tauri::command]
pub fn read_note_version(relative_path: String, version_id: String) -> Result<String, String> {
    let root = ensure_vault()?;
    if version_id.contains("..") || version_id.contains('/') || version_id.contains('\\') {
        return Err("Identifiant de version invalide".into());
    }
    let path = history_dir(&root, &relative_path).join(format!("{version_id}.md"));
    if !path.is_file() {
        return Err("Version introuvable".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_note_version(relative_path: String, version_id: String) -> Result<String, String> {
    require_md_extension(&relative_path)?;
    let root = ensure_vault()?;
    let cfg = crate::commands::config::load_config();
    let version = read_note_version(relative_path.clone(), version_id)?;
    let path = resolve_path(&relative_path)?;
    if cfg.note_history_enabled && path.is_file() {
        if let Ok(prev) = fs::read_to_string(&path) {
            let _ = push_note_snapshot(&root, &relative_path, &prev, cfg.note_history_max);
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(&path, version.as_bytes())?;
    Ok(version)
}

fn collect_txt_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".history" || name == "media" || name == "assets" || name == "_media" {
            continue;
        }
        if path.is_dir() {
            collect_txt_files(&path, out);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "txt" || ext == "text" {
            out.push(path);
        }
    }
}

fn txt_body_to_markdown(stem: &str, body: &str) -> String {
    let body = body.replace("\r\n", "\n").replace('\r', "\n");
    if body.trim_start().starts_with("---") {
        return body;
    }
    let title = stem.replace('_', " ");
    format!(
        "---\ntitle: {title}\ntags: [import, txt]\ncreated: {}\n---\n\n# {title}\n\n{body}",
        chrono::Local::now().format("%Y-%m-%d"),
    )
}

/// Parcourt le vault : chaque .txt sans .md jumeau → crée la copie .md (conserve le .txt).
#[tauri::command]
pub fn sync_txt_notes() -> Result<Vec<String>, String> {
    let root = ensure_vault()?;
    let mut txts = Vec::new();
    collect_txt_files(&root, &mut txts);
    let mut created = Vec::new();

    for txt in txts {
        let Some(stem) = txt.file_stem().map(|s| s.to_string_lossy().to_string()) else {
            continue;
        };
        let md = txt.with_extension("md");
        if md.exists() {
            continue;
        }
        let body = fs::read_to_string(&txt).map_err(|e| e.to_string())?;
        let content = txt_body_to_markdown(&stem, &body);
        atomic_write(&md, content.as_bytes())?;
        let relative = md
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        created.push(relative);
    }
    Ok(created)
}

#[tauri::command]
pub fn create_note(parent_path: String, name: String) -> Result<String, String> {
    let root = ensure_vault()?;
    let safe_name = sanitize_name(&name)?;
    let file_name = if safe_name.ends_with(".md") {
        safe_name.clone()
    } else {
        format!("{safe_name}.md")
    };

    let parent = if parent_path.is_empty() {
        root.clone()
    } else {
        resolve_path(&parent_path)?
    };

    let path = parent.join(&file_name);
    if path.exists() {
        return Err("Une note avec ce nom existe déjà".into());
    }

    let relative = path
        .strip_prefix(&root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let content = format!(
        "---\ntitle: {}\ncreated: {}\n---\n\n# {}\n\n",
        safe_name.trim_end_matches(".md"),
        chrono::Local::now().format("%Y-%m-%d"),
        safe_name.trim_end_matches(".md")
    );

    atomic_write(&path, content.as_bytes())?;
    Ok(relative)
}

/// Importe des fichiers .txt (ex. export Nextcloud) vers des notes .md du vault.
#[tauri::command]
pub fn import_text_files(paths: Vec<String>, parent_path: String) -> Result<Vec<String>, String> {
    let root = ensure_vault()?;
    let parent = if parent_path.trim().is_empty() {
        root.clone()
    } else {
        let p = resolve_path(parent_path.trim())?;
        if !p.is_dir() {
            return Err("La destination doit être un dossier".into());
        }
        p
    };

    let mut created = Vec::new();
    for raw in paths {
        let source = PathBuf::from(raw.trim());
        if !source.is_file() {
            continue;
        }
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "txt" && ext != "text" && ext != "md" {
            continue;
        }

        let stem = source
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Note importée".into());
        let safe = sanitize_name(&stem).unwrap_or_else(|_| "Note_importee".into());
        let mut file_name = format!("{safe}.md");
        let mut dest = parent.join(&file_name);
        let mut n = 2;
        while dest.exists() {
            file_name = format!("{safe}-{n}.md");
            dest = parent.join(&file_name);
            n += 1;
        }

        let body = fs::read_to_string(&source).map_err(|e| e.to_string())?;
        if body.len() > MAX_IMPORT_TEXT_BYTES {
            continue;
        }
        let body = body.replace("\r\n", "\n").replace('\r', "\n");
        let title = safe.replace('_', " ");
        let content = if body.trim_start().starts_with("---") {
            body
        } else {
            format!(
                "---\ntitle: {title}\ntags: [import]\ncreated: {}\n---\n\n# {title}\n\n{body}",
                chrono::Local::now().format("%Y-%m-%d"),
            )
        };

        atomic_write(&dest, content.as_bytes())?;
        let relative = dest
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        created.push(relative);
    }

    if created.is_empty() {
        return Err("Aucun fichier .txt / .md importé.".into());
    }
    Ok(created)
}

#[tauri::command]
pub fn create_folder(parent_path: String, name: String) -> Result<String, String> {
    let root = ensure_vault()?;
    let safe_name = sanitize_name(&name)?;

    let parent = if parent_path.is_empty() {
        root.clone()
    } else {
        resolve_path(&parent_path)?
    };

    let path = parent.join(&safe_name);
    if path.exists() {
        return Err("Un dossier avec ce nom existe déjà".into());
    }

    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    Ok(path
        .strip_prefix(&root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub fn delete_item(relative_path: String) -> Result<(), String> {
    let path = resolve_path(&relative_path)?;
    if path.is_dir() {
        return fs::remove_dir_all(&path).map_err(|e| e.to_string());
    }

    // Si on supprime un .md issu du sync TXT, retirer aussi le jumeau .txt/.text
    // sinon la prochaine sync recrée immédiatement le .md.
    let is_md = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if is_md {
        for ext in ["txt", "text"] {
            let sibling = path.with_extension(ext);
            if sibling.is_file() {
                let _ = fs::remove_file(&sibling);
            }
        }
        // Nettoyer l'historique local de la note (best-effort).
        if let Ok(root) = ensure_vault() {
            let hist = history_dir(&root, &relative_path);
            if hist.is_dir() {
                let _ = fs::remove_dir_all(&hist);
            }
        }
    }

    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_vault_item(relative_path: String, destination_parent: String) -> Result<String, String> {
    let root = ensure_vault()?;
    let source = resolve_path(&relative_path)?;

    if !source.exists() {
        return Err("Élément introuvable".into());
    }

    let dest_parent = if destination_parent.trim().is_empty() {
        root.clone()
    } else {
        let parent = resolve_path(destination_parent.trim())?;
        if !parent.is_dir() {
            return Err("La destination doit être un dossier".into());
        }
        parent
    };

    let source_parent = source
        .parent()
        .ok_or("Impossible de déterminer le dossier source")?;
    if source_parent == dest_parent {
        return Ok(relative_path.replace('\\', "/"));
    }

    if source.is_dir() {
        let source_canon = source.canonicalize().unwrap_or_else(|_| source.clone());
        let dest_canon = dest_parent.canonicalize().unwrap_or_else(|_| dest_parent.clone());
        if dest_canon.starts_with(&source_canon) {
            return Err("Impossible de déplacer un dossier dans lui-même ou un sous-dossier".into());
        }
    }

    let file_name = source
        .file_name()
        .ok_or("Nom d'élément invalide")?
        .to_string_lossy()
        .to_string();
    let dest = dest_parent.join(&file_name);

    if dest.exists() {
        return Err(format!(
            "« {file_name} » existe déjà dans ce dossier"
        ));
    }

    fs::rename(&source, &dest).map_err(|e| format!("Déplacement impossible : {e}"))?;

    Ok(dest
        .strip_prefix(&root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub fn export_note(relative_path: String, destination: String) -> Result<(), String> {
    require_md_extension(&relative_path)?;
    let source = resolve_path(&relative_path)?;
    let dest = validate_export_destination(&destination)?;
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_image(
    source_path: String,
    note_path: Option<String>,
    use_global_media: Option<bool>,
) -> Result<String, String> {
    let root = ensure_vault()?;
    let source = PathBuf::from(source_path.trim());
    if !source.is_absolute() {
        return Err("Le chemin source doit être absolu.".into());
    }
    if !source.is_file() {
        return Err("Fichier source introuvable".into());
    }

    let ext = normalize_image_ext(&source, "png")?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMPORT_IMAGE_BYTES {
        return Err("Image trop volumineuse (max 15 Mo).".into());
    }
    validate_image_magic(&bytes, &ext)?;
    store_imported_bytes(
        &root,
        &bytes,
        &ext,
        note_path.as_deref(),
        use_global_media.unwrap_or(false),
    )
}

#[tauri::command]
pub fn import_image_bytes(
    data_base64: String,
    extension: Option<String>,
    note_path: Option<String>,
    use_global_media: Option<bool>,
) -> Result<String, String> {
    let root = ensure_vault()?;
    let bytes = STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("Image invalide : {e}"))?;
    if bytes.is_empty() {
        return Err("Image vide".into());
    }
    if bytes.len() > MAX_IMPORT_IMAGE_BYTES {
        return Err("Image trop volumineuse (max 15 Mo).".into());
    }

    let ext = extension
        .map(|e| e.trim().trim_start_matches('.').to_lowercase())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "png".to_string());

    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Format d'image non supporté".into());
    }
    validate_image_magic(&bytes, &ext)?;

    store_imported_bytes(
        &root,
        &bytes,
        &ext,
        note_path.as_deref(),
        use_global_media.unwrap_or(false),
    )
}

fn extract_title(content: &str, fallback: &str) -> String {
    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("---") {
            let frontmatter = &rest[..end];
            for line in frontmatter.lines() {
                if let Some(title) = line.strip_prefix("title:") {
                    return title.trim().trim_matches('"').to_string();
                }
            }
        }
    }
    for line in content.lines() {
        if let Some(h1) = line.strip_prefix("# ") {
            return h1.trim().to_string();
        }
    }
    fallback.to_string()
}

fn search_in_dir(dir: &Path, root: &Path, query: &str, results: &mut Vec<SearchResult>) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    let query_lower = query.to_lowercase();

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if is_hidden_media_dir(name, &path, dir, root) {
                continue;
            }
            search_in_dir(&path, root, query, results);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };

            let relative = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();

            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            let title = extract_title(&content, &name);
            let content_lower = content.to_lowercase();

            if name.to_lowercase().contains(&query_lower)
                || title.to_lowercase().contains(&query_lower)
                || content_lower.contains(&query_lower)
            {
                let snippet = content
                    .lines()
                    .find(|l| l.to_lowercase().contains(&query_lower))
                    .unwrap_or("")
                    .chars()
                    .take(120)
                    .collect();

                results.push(SearchResult {
                    path: relative,
                    title,
                    snippet,
                });
            }
        }
    }
}

#[tauri::command]
pub fn search_vault(query: String) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let root = ensure_vault()?;
    let mut results = Vec::new();
    search_in_dir(&root, &root, query.trim(), &mut results);
    results.truncate(20);
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::is_safe_vault_relative;

    #[test]
    fn accepts_normal_note_paths() {
        assert!(is_safe_vault_relative("Bienvenue.md"));
        assert!(is_safe_vault_relative("dossier/note.md"));
        assert!(is_safe_vault_relative("a/b/c.md"));
        assert!(is_safe_vault_relative(""));
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(!is_safe_vault_relative("../secret.md"));
        assert!(!is_safe_vault_relative("notes/../../etc/passwd"));
        assert!(!is_safe_vault_relative(r"..\windows\system32"));
        assert!(!is_safe_vault_relative(r"C:\Windows\notepad.exe"));
        assert!(!is_safe_vault_relative("/etc/passwd"));
    }

    #[test]
    fn rejects_non_md_for_read_write() {
        assert!(super::require_md_extension("note.txt").is_err());
        assert!(super::require_md_extension("note.md").is_ok());
    }

    #[test]
    fn validates_png_magic_bytes() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00];
        assert!(super::validate_image_magic(&png, "png").is_ok());
        assert!(super::validate_image_magic(&[0x00, 0x01], "png").is_err());
    }
}
