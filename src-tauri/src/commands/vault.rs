use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const WELCOME_NOTE: &str = r#"---
title: Bienvenue
tags: [accueil]
created: 2026-09-01
---

# Bienvenue dans CyberScribeNote

Votre coffre de notes **100 % local** est prêt.

## Premiers pas

- Créez des dossiers et notes depuis la barre latérale
- Éditez en Markdown — sauvegarde automatique
- **Ctrl+T** : recherche rapide
- Bouton **IA** : résumer via Ollama (localhost:11434)

## Philosophie

Local • Privé • Vocal • Minimaliste • Doux pour les yeux
"#;

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

    let welcome = root.join("Bienvenue.md");
    if !welcome.exists() {
        fs::write(&welcome, WELCOME_NOTE).map_err(|e| e.to_string())?;
    }
    Ok(root)
}

fn is_hidden_media_dir(name: &str, path: &Path, parent: &Path, root: &Path) -> bool {
    if name == "_media" && path.is_dir() {
        return true;
    }
    path.is_dir() && parent == root && (name == "assets" || name == "media")
}

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

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
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;

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
pub fn init_vault() -> Result<String, String> {
    let root = ensure_vault()?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_vault() -> Result<Vec<VaultEntry>, String> {
    let root = ensure_vault()?;
    read_dir_recursive(&root, &root)
}

#[tauri::command]
pub fn read_note(relative_path: String) -> Result<String, String> {
    let path = resolve_path(&relative_path)?;
    if !path.is_file() {
        return Err("Ce n'est pas un fichier".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note(relative_path: String, content: String) -> Result<(), String> {
    let path = resolve_path(&relative_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
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

    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(relative)
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
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
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
    let source = resolve_path(&relative_path)?;
    fs::copy(&source, &destination).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_image(
    source_path: String,
    note_path: Option<String>,
    use_global_media: Option<bool>,
) -> Result<String, String> {
    let root = ensure_vault()?;
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Fichier source introuvable".into());
    }

    let ext = normalize_image_ext(&source, "png")?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
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

    let ext = extension
        .map(|e| e.trim().trim_start_matches('.').to_lowercase())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "png".to_string());

    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err("Format d'image non supporté".into());
    }

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
}
