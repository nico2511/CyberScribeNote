use crate::commands::config::load_config;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

const DEFAULT_HOST: &str = "http://127.0.0.1:11434";

fn host_url() -> String {
    load_config().ollama_host.trim_end_matches('/').to_string()
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub available: bool,
    pub models: Vec<String>,
    pub host: String,
    pub selected_model: String,
    pub network_mode: String,
    pub is_localhost: bool,
    pub ollama_host_env: Option<String>,
    pub network_guidance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaDetect {
    pub cli_installed: bool,
    pub service_running: bool,
    pub host: String,
    pub selected_model: String,
    pub network_mode: String,
    pub is_localhost: bool,
    pub ollama_host_env: Option<String>,
    pub network_guidance: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub model: String,
    pub status: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub percent: Option<f32>,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedModel {
    pub id: String,
    pub label: String,
    pub size: String,
    pub description: String,
}

fn cli_installed() -> bool {
    #[cfg(target_os = "windows")]
    {
        Command::new("where")
            .arg("ollama")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("which")
            .arg("ollama")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

async fn ping_service(host: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    client
        .get(format!("{host}/api/tags"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn analyze_network(host: &str) -> (String, bool, Option<String>) {
    let lower = host.to_lowercase();
    let is_localhost = lower.contains("127.0.0.1") || lower.contains("localhost");
    let ollama_env = std::env::var("OLLAMA_HOST").ok();

    let network_mode = if is_localhost {
        "local".to_string()
    } else {
        "réseau".to_string()
    };

    let mut guidance = None;
    if !is_localhost {
        guidance = Some(
            "Connexion réseau configurée. Si Ollama est sur cette machine, \
             définissez OLLAMA_HOST=0.0.0.0 et redémarrez le service Ollama."
                .into(),
        );
    } else if let Some(ref env) = ollama_env {
        if env.contains("0.0.0.0") {
            guidance = Some(format!(
                "OLLAMA_HOST={env} — Ollama écoute sur toutes les interfaces."
            ));
        }
    } else {
        guidance = Some(
            "Connexion locale (127.0.0.1). Pour exposer sur le réseau : \
             OLLAMA_HOST=0.0.0.0 puis redémarrer Ollama."
                .into(),
        );
    }

    (network_mode, is_localhost, guidance)
}

#[tauri::command]
pub async fn ollama_detect() -> Result<OllamaDetect, String> {
    let config = load_config();
    let host = config.ollama_host.trim_end_matches('/').to_string();
    let service_running = ping_service(&host).await;
    let (network_mode, is_localhost, network_guidance) = analyze_network(&host);
    let ollama_host_env = std::env::var("OLLAMA_HOST").ok();

    Ok(OllamaDetect {
        cli_installed: cli_installed(),
        service_running,
        host,
        selected_model: config.selected_model,
        network_mode,
        is_localhost,
        ollama_host_env,
        network_guidance,
    })
}

#[tauri::command]
pub async fn ollama_status() -> Result<OllamaStatus, String> {
    let config = load_config();
    let host = config.ollama_host.trim_end_matches('/').to_string();
    let (network_mode, is_localhost, network_guidance) = analyze_network(&host);
    let ollama_host_env = std::env::var("OLLAMA_HOST").ok();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(format!("{host}/api/tags")).send().await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            let models = body
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| {
                            item.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        })
                        .collect()
                })
                .unwrap_or_default();

            Ok(OllamaStatus {
                available: true,
                models,
                host,
                selected_model: config.selected_model,
                network_mode,
                is_localhost,
                ollama_host_env,
                network_guidance,
            })
        }
        _ => Ok(OllamaStatus {
            available: false,
            models: vec![],
            host,
            selected_model: config.selected_model,
            network_mode,
            is_localhost,
            ollama_host_env,
            network_guidance,
        }),
    }
}

#[tauri::command]
pub fn ollama_recommended_models() -> Vec<RecommendedModel> {
    vec![
        RecommendedModel {
            id: "llama3.2".into(),
            label: "Llama 3.2".into(),
            size: "~2 Go".into(),
            description: "Polyvalent, recommandé pour les notes".into(),
        },
        RecommendedModel {
            id: "phi3".into(),
            label: "Phi-3".into(),
            size: "~2 Go".into(),
            description: "Rapide, efficace en français".into(),
        },
        RecommendedModel {
            id: "qwen2.5:3b".into(),
            label: "Qwen 2.5 3B".into(),
            size: "~2 Go".into(),
            description: "Excellent multilingue".into(),
        },
        RecommendedModel {
            id: "gemma2:2b".into(),
            label: "Gemma 2 2B".into(),
            size: "~1,6 Go".into(),
            description: "Très léger, idéal machines modestes".into(),
        },
        RecommendedModel {
            id: "nomic-embed-text".into(),
            label: "Nomic Embed".into(),
            size: "~274 Mo".into(),
            description: "Embeddings pour recherche sémantique (Phase 2)".into(),
        },
    ]
}

#[tauri::command]
pub async fn ollama_pull_model(app: AppHandle, model: String) -> Result<(), String> {
    let host = host_url();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(format!("{host}/api/pull"))
        .json(&serde_json::json!({ "name": model, "stream": true }))
        .send()
        .await
        .map_err(|e| format!("Impossible de contacter Ollama : {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama a répondu avec le statut {}", response.status()));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let json: serde_json::Value =
                serde_json::from_str(line).map_err(|e| format!("Réponse Ollama invalide : {e}"))?;

            if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                let progress = PullProgress {
                    model: model.clone(),
                    status: "error".into(),
                    completed: None,
                    total: None,
                    percent: None,
                    done: true,
                    error: Some(err.into()),
                };
                app.emit("ollama-pull-progress", progress)
                    .map_err(|e| e.to_string())?;
                return Err(err.into());
            }

            let status = json
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let completed = json.get("completed").and_then(|v| v.as_u64());
            let total = json.get("total").and_then(|v| v.as_u64());
            let done = json.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            let percent = match (completed, total) {
                (Some(c), Some(t)) if t > 0 => Some((c as f32 / t as f32) * 100.0),
                _ => None,
            };

            let progress = PullProgress {
                model: model.clone(),
                status,
                completed,
                total,
                percent,
                done,
                error: None,
            };
            app.emit("ollama-pull-progress", progress)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn ollama_delete_model(model: String) -> Result<(), String> {
    let host = host_url();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .delete(format!("{host}/api/delete"))
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("Suppression échouée (statut {})", response.status()))
    }
}

#[tauri::command]
pub fn ollama_install() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("winget")
            .args([
                "install",
                "-e",
                "--id",
                "Ollama.Ollama",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ])
            .output()
            .map_err(|e| format!("winget introuvable : {e}"))?;

        if output.status.success() {
            Ok("Installation Ollama lancée via winget. Redémarrez l'application une fois terminée.".into())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Installation winget échouée : {stderr}"))
        }
    }

    #[cfg(target_os = "macos")]
    {
        Ok("Téléchargez Ollama sur https://ollama.com/download/mac puis relancez l'app.".into())
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Ok("Exécutez : curl -fsSL https://ollama.com/install.sh | sh".into())
    }
}

#[tauri::command]
pub fn ollama_start_service() -> Result<String, String> {
    if !cli_installed() {
        return Err("Ollama n'est pas installé ou absent du PATH.".into());
    }

    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", "ollama", "app"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(windows))]
    {
        Command::new("ollama")
            .arg("serve")
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok("Démarrage d'Ollama demandé.".into())
}

#[tauri::command]
pub async fn ollama_generate(prompt: String, model: Option<String>) -> Result<String, String> {
    let config = load_config();
    let host = config.ollama_host.trim_end_matches('/').to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let model = model.unwrap_or(config.selected_model);

    let body = OllamaRequest {
        model,
        prompt,
        stream: false,
    };

    let response = client
        .post(format!("{host}/api/generate"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama inaccessible : {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama a répondu avec le statut {}", response.status()));
    }

    let parsed: OllamaResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.response.trim().to_string())
}

#[tauri::command]
pub async fn ollama_summarize_note(
    content: String,
    model: Option<String>,
    note_context: Option<String>,
) -> Result<String, String> {
    let context_block = format_note_context(note_context.as_deref());
    let prompt = format!(
        "Tu es un assistant de prise de notes.{context_block} \
         Résume le passage suivant en français, en 3 à 5 phrases concises. \
         Ne répète pas le titre.\n\n---\n{content}\n---"
    );
    ollama_generate(prompt, model).await
}

#[tauri::command]
pub async fn ollama_transform_note(
    action: String,
    content: String,
    model: Option<String>,
    note_context: Option<String>,
) -> Result<String, String> {
    let context_block = format_note_context(note_context.as_deref());
    let prompt = match action.as_str() {
        "reformulate" => format!(
            "Reformule ce texte en français, plus clair et fluide, sans changer le sens.{context_block} \
             Réponds uniquement avec le texte reformulé.\n\n{content}"
        ),
        "correct" => format!(
            "Corrige l'orthographe et la grammaire de ce texte en français.{context_block} \
             Réponds uniquement avec le texte corrigé.\n\n{content}"
        ),
        "translate_en" => format!(
            "Traduis ce texte en anglais.{context_block} \
             Réponds uniquement avec la traduction.\n\n{content}"
        ),
        _ => return Err(format!("Action IA inconnue : {action}")),
    };
    ollama_generate(prompt, model).await
}

fn format_note_context(note_context: Option<&str>) -> String {
    let Some(ctx) = note_context.map(str::trim).filter(|c| !c.is_empty()) else {
        return String::new();
    };
    format!(
        " Contexte / objectif de la note : {ctx}. Respecte cet objectif dans ta réponse."
    )
}

#[allow(dead_code)]
pub fn default_host() -> &'static str {
    DEFAULT_HOST
}
