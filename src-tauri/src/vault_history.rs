use crate::fs_util::atomic_write;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn legacy_history_key(relative: &str) -> String {
    relative.replace('\\', "/").replace('/', "__")
}

pub fn history_key(relative: &str) -> String {
    use sha2::{Digest, Sha256};
    let norm = relative.replace('\\', "/");
    format!("{:x}", Sha256::digest(norm.as_bytes()))
}

fn history_dir(root: &Path, relative: &str) -> PathBuf {
    root.join(".history").join(history_key(relative))
}

/// Résout le dossier snapshots ; migre l'ancien format `a__b.md` si besoin.
pub fn resolve_history_dir(root: &Path, relative: &str) -> PathBuf {
    let dir = history_dir(root, relative);
    if dir.is_dir() {
        return dir;
    }
    let legacy = root.join(".history").join(legacy_history_key(relative));
    if legacy.is_dir() {
        if let Some(parent) = dir.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::rename(&legacy, &dir).is_ok() {
            return dir;
        }
        return legacy;
    }
    dir
}

pub fn migrate_note_history(
    root: &Path,
    old_relative: &str,
    new_relative: &str,
) -> Result<(), String> {
    let old_norm = old_relative.replace('\\', "/");
    let new_norm = new_relative.replace('\\', "/");
    if old_norm == new_norm {
        return Ok(());
    }

    let old_dir = resolve_history_dir(root, old_relative);
    let legacy = root.join(".history").join(legacy_history_key(old_relative));
    let source_hist = if old_dir.is_dir() {
        old_dir
    } else if legacy.is_dir() {
        legacy
    } else {
        return Ok(());
    };

    let dest = history_dir(root, new_relative);
    if dest.exists() {
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(&source_hist).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let target = dest.join(entry.file_name());
            if !target.exists() {
                fs::rename(entry.path(), target).map_err(|e| e.to_string())?;
            }
        }
        let _ = fs::remove_dir_all(&source_hist);
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&source_hist, &dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn collect_md_relative(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "_media" || name == "assets" || name == "media" {
            continue;
        }
        if path.is_dir() {
            collect_md_relative(&path, root, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let relative = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            if !relative.is_empty() {
                out.push(relative);
            }
        }
    }
}

pub fn migrate_folder_histories(
    root: &Path,
    old_prefix: &str,
    new_prefix: &str,
) -> Result<(), String> {
    let old_p = old_prefix.trim_end_matches('/');
    let new_p = new_prefix.trim_end_matches('/');
    let dest_dir = root.join(new_p);
    if !dest_dir.is_dir() {
        return Ok(());
    }
    let mut notes = Vec::new();
    collect_md_relative(&dest_dir, root, &mut notes);
    for new_rel in notes {
        if new_rel == new_p {
            continue;
        }
        if let Some(suffix) = new_rel.strip_prefix(&format!("{new_p}/")) {
            let old_rel = format!("{old_p}/{suffix}");
            migrate_note_history(root, &old_rel, &new_rel)?;
        }
    }
    Ok(())
}

pub fn push_note_snapshot(
    root: &Path,
    relative: &str,
    content: &str,
    max_versions: u32,
) -> Result<(), String> {
    let dir = resolve_history_dir(root, relative);
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

pub fn remove_history_tree(root: &Path, relative_path: &str) {
    let hist = resolve_history_dir(root, relative_path);
    if hist.is_dir() {
        let _ = fs::remove_dir_all(&hist);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub id: String,
    pub label: String,
    pub bytes: u64,
}

fn format_history_label(id: &str) -> String {
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

pub fn list_note_history_entries(
    root: &Path,
    relative_path: &str,
) -> Result<Vec<NoteHistoryEntry>, String> {
    let dir = resolve_history_dir(root, relative_path);
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

pub fn read_note_version_content(
    root: &Path,
    relative_path: &str,
    version_id: &str,
) -> Result<String, String> {
    if version_id.contains("..") || version_id.contains('/') || version_id.contains('\\') {
        return Err("Identifiant de version invalide".into());
    }
    let path = resolve_history_dir(root, relative_path).join(format!("{version_id}.md"));
    if !path.is_file() {
        return Err("Version introuvable".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{history_key, legacy_history_key};

    #[test]
    fn history_key_uses_sha256() {
        let key = history_key("folder/note.md");
        assert_eq!(key.len(), 64);
        assert_ne!(key, legacy_history_key("folder/note.md"));
        assert_ne!(history_key("a/b.md"), history_key("a__b.md"));
    }
}
