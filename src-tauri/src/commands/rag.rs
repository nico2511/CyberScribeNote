use crate::commands::vault::vault_root;
use crate::fs_util::atomic_write;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const EMBED_MODEL: &str = "nomic-embed-text";
const CHUNK_CHARS: usize = 700;
const CHUNK_OVERLAP: usize = 80;
const TOP_K: usize = 5;
const INDEX_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChunk {
    pub text: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagNoteEntry {
    pub path: String,
    pub title: String,
    pub content_hash: String,
    pub mtime_secs: u64,
    pub chunks: Vec<RagChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndex {
    pub version: u32,
    pub model: String,
    pub updated_at: String,
    pub vault_path: String,
    pub notes: Vec<RagNoteEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStatus {
    pub indexed: bool,
    pub model: String,
    pub chunk_count: usize,
    pub note_count: usize,
    pub updated_at: Option<String>,
    pub index_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagHit {
    pub path: String,
    pub title: String,
    pub text: String,
    pub score: f32,
}

fn index_path() -> Result<PathBuf, String> {
    let root = vault_root()?;
    Ok(root.join(".rag").join("index.json"))
}

fn content_hash(body: &str) -> String {
    format!("{:x}", Sha256::digest(body.as_bytes()))
}

fn file_mtime_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn embed_text(client: &reqwest::Client, text: &str) -> Result<Vec<f32>, String> {
    let host = crate::commands::config::host_url();
    let response = client
        .post(format!("{host}/api/embeddings"))
        .json(&serde_json::json!({
            "model": EMBED_MODEL,
            "prompt": text,
        }))
        .send()
        .await
        .map_err(|e| format!("Ollama embeddings inaccessible : {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Embeddings échoués ({status}). Tirez le modèle `{EMBED_MODEL}` dans Réglages. {body}"
        ));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let embedding = json
        .get("embedding")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Réponse embeddings invalide".to_string())?
        .iter()
        .filter_map(|v| v.as_f64().map(|f| f as f32))
        .collect::<Vec<_>>();

    if embedding.is_empty() {
        return Err("Embedding vide".into());
    }
    Ok(embedding)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom < 1e-9 {
        0.0
    } else {
        dot / denom
    }
}

fn note_title(path: &str, content: &str) -> String {
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            return rest.trim().to_string();
        }
    }
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .to_string()
}

fn strip_frontmatter(content: &str) -> String {
    if !content.starts_with("---") {
        return content.to_string();
    }
    if let Some(end) = content[3..].find("---") {
        return content[end + 6..].trim_start().to_string();
    }
    content.to_string()
}

fn chunk_text(text: &str) -> Vec<String> {
    let cleaned = text.trim();
    if cleaned.is_empty() {
        return vec![];
    }
    let chars: Vec<char> = cleaned.chars().collect();
    if chars.len() <= CHUNK_CHARS {
        return vec![cleaned.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut end = (start + CHUNK_CHARS).min(chars.len());
        if end < chars.len() {
            let window_start = start + CHUNK_CHARS / 2;
            if let Some(rel) = chars[window_start..end]
                .iter()
                .rposition(|c| c.is_whitespace())
            {
                end = window_start + rel + 1;
            }
        }
        let piece: String = chars[start..end].iter().collect();
        let piece = piece.trim();
        if piece.len() > 40 {
            chunks.push(piece.to_string());
        }
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
        if start >= end {
            start = end;
        }
    }
    chunks
}

fn collect_markdown_files(dir: &Path, root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name == "_media" || name == "assets" || name == "media" {
            continue;
        }
        if path.is_dir() {
            collect_markdown_files(&path, root, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            out.push(path);
        }
    }
}

fn load_index() -> Option<RagIndex> {
    let path = index_path().ok()?;
    let raw = fs::read_to_string(path).ok()?;
    let idx: RagIndex = serde_json::from_str(&raw).ok()?;
    if idx.version != INDEX_VERSION {
        return None;
    }
    Some(idx)
}

fn save_index(index: &RagIndex) -> Result<(), String> {
    let path = index_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(index).map_err(|e| e.to_string())?;
    atomic_write(&path, json.as_bytes())
}

fn status_from_index(path: &Path, idx: Option<RagIndex>) -> RagStatus {
    match idx {
        Some(idx) => {
            let chunk_count: usize = idx.notes.iter().map(|n| n.chunks.len()).sum();
            RagStatus {
                indexed: chunk_count > 0,
                model: idx.model,
                chunk_count,
                note_count: idx.notes.len(),
                updated_at: Some(idx.updated_at),
                index_path: path.to_string_lossy().to_string(),
            }
        }
        None => RagStatus {
            indexed: false,
            model: EMBED_MODEL.into(),
            chunk_count: 0,
            note_count: 0,
            updated_at: None,
            index_path: path.to_string_lossy().to_string(),
        },
    }
}

#[tauri::command]
pub fn rag_status() -> Result<RagStatus, String> {
    let path = index_path()?;
    Ok(status_from_index(&path, load_index()))
}

#[tauri::command]
pub async fn rag_reindex() -> Result<RagStatus, String> {
    let root = vault_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    collect_markdown_files(&root, &root, &mut files);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let _ = embed_text(&client, "ping cyberscribe rag").await?;

    let existing = load_index().unwrap_or(RagIndex {
        version: INDEX_VERSION,
        model: EMBED_MODEL.into(),
        updated_at: String::new(),
        vault_path: root.to_string_lossy().to_string(),
        notes: vec![],
    });

    let vault_str = root.to_string_lossy().to_string();
    let same_vault = existing.vault_path == vault_str;
    let mut prior: HashMap<String, RagNoteEntry> = HashMap::new();
    if same_vault {
        for note in existing.notes {
            prior.insert(note.path.clone(), note);
        }
    }

    let mut notes: Vec<RagNoteEntry> = Vec::new();

    for file in files {
        let Ok(raw) = fs::read_to_string(&file) else {
            continue;
        };
        let relative = file
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if relative.is_empty() {
            continue;
        }

        let body = strip_frontmatter(&raw);
        let hash = content_hash(&body);
        let mtime = file_mtime_secs(&file);

        if let Some(prev) = prior.get(&relative) {
            if prev.content_hash == hash && prev.mtime_secs == mtime && !prev.chunks.is_empty() {
                notes.push(prev.clone());
                continue;
            }
        }

        let title = note_title(&relative, &body);
        let pieces = chunk_text(&body);
        if pieces.is_empty() {
            continue;
        }

        let mut chunks = Vec::new();
        for piece in pieces {
            let embedding = embed_text(&client, &piece).await?;
            chunks.push(RagChunk {
                text: piece,
                embedding,
            });
        }

        notes.push(RagNoteEntry {
            path: relative,
            title,
            content_hash: hash,
            mtime_secs: mtime,
            chunks,
        });
    }

    notes.sort_by(|a, b| a.path.cmp(&b.path));

    let index = RagIndex {
        version: INDEX_VERSION,
        model: EMBED_MODEL.into(),
        updated_at: chrono::Local::now().to_rfc3339(),
        vault_path: vault_str,
        notes,
    };
    save_index(&index)?;
    rag_status()
}

#[tauri::command]
pub async fn rag_query(
    query: String,
    top_k: Option<usize>,
    exclude_path: Option<String>,
) -> Result<Vec<RagHit>, String> {
    let q = query.trim();
    if q.len() < 8 {
        return Ok(vec![]);
    }

    let index = load_index().ok_or_else(|| {
        "Index RAG absent — lancez « Indexer le vault » dans Réglages.".to_string()
    })?;
    if index.notes.is_empty() {
        return Ok(vec![]);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let query_vec = embed_text(&client, q).await?;

    let exclude = exclude_path.unwrap_or_default();
    let k = top_k.unwrap_or(TOP_K).clamp(1, 12);

    let mut scored: Vec<RagHit> = Vec::new();
    for note in &index.notes {
        if !exclude.is_empty() && note.path == exclude {
            continue;
        }
        for chunk in &note.chunks {
            let score = cosine(&query_vec, &chunk.embedding);
            if score > 0.25 {
                scored.push(RagHit {
                    path: note.path.clone(),
                    title: note.title.clone(),
                    text: chunk.text.clone(),
                    score,
                });
            }
        }
    }

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    Ok(scored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_hash_is_stable() {
        assert_eq!(content_hash("hello"), content_hash("hello"));
        assert_ne!(content_hash("a"), content_hash("b"));
    }
}
