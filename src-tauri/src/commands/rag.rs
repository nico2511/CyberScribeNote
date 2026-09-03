use crate::commands::config::host_url;
use crate::commands::vault::vault_root;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const EMBED_MODEL: &str = "nomic-embed-text";
const CHUNK_CHARS: usize = 700;
const CHUNK_OVERLAP: usize = 80;
const TOP_K: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagChunk {
    pub path: String,
    pub title: String,
    pub text: String,
    pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndex {
    pub model: String,
    pub updated_at: String,
    pub chunk_count: usize,
    pub note_count: usize,
    pub chunks: Vec<RagChunk>,
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

fn index_path() -> PathBuf {
    dirs::document_dir()
        .map(|d| d.join("CyberScribeNote").join("rag_index.json"))
        .unwrap_or_else(|| PathBuf::from("rag_index.json"))
}

async fn embed_text(client: &reqwest::Client, text: &str) -> Result<Vec<f32>, String> {
    let host = host_url();
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
            // Coupe sur un espace proche de la fin
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

fn collect_markdown_files(dir: &std::path::Path, root: &std::path::Path, out: &mut Vec<PathBuf>) {
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
    let path = index_path();
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_index(index: &RagIndex) -> Result<(), String> {
    let path = index_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rag_status() -> RagStatus {
    let path = index_path();
    match load_index() {
        Some(idx) => RagStatus {
            indexed: !idx.chunks.is_empty(),
            model: idx.model,
            chunk_count: idx.chunk_count,
            note_count: idx.note_count,
            updated_at: Some(idx.updated_at),
            index_path: path.to_string_lossy().to_string(),
        },
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
pub async fn rag_reindex() -> Result<RagStatus, String> {
    let root = vault_root()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    collect_markdown_files(&root, &root, &mut files);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    // Warm-up / vérifie le modèle
    let _ = embed_text(&client, "ping cyberscribe rag").await?;

    let mut chunks: Vec<RagChunk> = Vec::new();
    let mut note_count = 0usize;

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
        let title = note_title(&relative, &body);
        let pieces = chunk_text(&body);
        if pieces.is_empty() {
            continue;
        }
        note_count += 1;

        for piece in pieces {
            let embedding = embed_text(&client, &piece).await?;
            chunks.push(RagChunk {
                path: relative.clone(),
                title: title.clone(),
                text: piece,
                embedding,
            });
        }
    }

    let index = RagIndex {
        model: EMBED_MODEL.into(),
        updated_at: chrono::Local::now().to_rfc3339(),
        chunk_count: chunks.len(),
        note_count,
        chunks,
    };
    save_index(&index)?;
    Ok(rag_status())
}

#[tauri::command]
pub async fn rag_query(query: String, top_k: Option<usize>, exclude_path: Option<String>) -> Result<Vec<RagHit>, String> {
    let q = query.trim();
    if q.len() < 8 {
        return Ok(vec![]);
    }

    let index = load_index().ok_or_else(|| {
        "Index RAG absent — lancez « Indexer le vault » dans Réglages.".to_string()
    })?;
    if index.chunks.is_empty() {
        return Ok(vec![]);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let query_vec = embed_text(&client, q).await?;

    let exclude = exclude_path.unwrap_or_default();
    let k = top_k.unwrap_or(TOP_K).clamp(1, 12);

    let mut scored: Vec<RagHit> = index
        .chunks
        .iter()
        .filter(|c| exclude.is_empty() || c.path != exclude)
        .map(|c| RagHit {
            path: c.path.clone(),
            title: c.title.clone(),
            text: c.text.clone(),
            score: cosine(&query_vec, &c.embedding),
        })
        .filter(|h| h.score > 0.25)
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    Ok(scored)
}
