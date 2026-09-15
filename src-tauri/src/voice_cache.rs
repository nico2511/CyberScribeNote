use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperCacheEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

pub fn list_whisper_cache_entries(models_dir: &Path, limit: usize) -> Vec<WhisperCacheEntry> {
    let mut entries = Vec::new();
    scan_cache_dir(models_dir, models_dir, &mut entries, 0);
    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    entries.truncate(limit);
    entries
}

fn scan_cache_dir(dir: &Path, base: &Path, entries: &mut Vec<WhisperCacheEntry>, depth: u32) {
    if depth > 4 {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            let size = dir_size(&path);
            entries.push(WhisperCacheEntry {
                name: name.clone(),
                path: path
                    .strip_prefix(base)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or(name),
                size_bytes: size,
                is_dir: true,
            });
            scan_cache_dir(&path, base, entries, depth + 1);
        } else {
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size > 0 {
                entries.push(WhisperCacheEntry {
                    name: name.clone(),
                    path: path
                        .strip_prefix(base)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or(name),
                    size_bytes: size,
                    is_dir: false,
                });
            }
        }
    }
}

pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(read_dir) = fs::read_dir(path) {
        for entry in read_dir.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = fs::metadata(&p) {
                total += meta.len();
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::dir_size;
    use std::fs;
    use std::io::Write;

    #[test]
    fn dir_size_sums_nested_files() {
        let base = std::env::temp_dir().join(format!("csn-voice-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("sub")).unwrap();
        let mut f = fs::File::create(base.join("sub/a.bin")).unwrap();
        f.write_all(&[0u8; 10]).unwrap();
        f = fs::File::create(base.join("b.bin")).unwrap();
        f.write_all(&[0u8; 5]).unwrap();
        assert_eq!(dir_size(&base), 15);
        let _ = fs::remove_dir_all(&base);
    }
}
