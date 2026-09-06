use crate::commands::config::{host_url, load_config};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const FAITHFUL_SYSTEM: &str = "Tu es un éditeur fidèle dans une application de notes. \
Tu transformes uniquement le texte fourni par l'utilisateur. \
Interdit : inventer un autre document, changer de sujet, produire une recette, \
un exemple générique, du lorem ipsum, ou t'appuyer sur un extrait hors sujet. \
Conserve tous les faits, noms, chemins, commandes, URLs et extraits de code.";

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaGenOptions>,
}

#[derive(Debug, Serialize)]
struct OllamaGenOptions {
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
}

struct GenerateParams {
    temperature: f32,
    system: Option<String>,
}

fn generate_params(kind: &str) -> GenerateParams {
    match kind {
        "correct" | "proactive" => GenerateParams {
            temperature: 0.0,
            system: Some(FAITHFUL_SYSTEM.into()),
        },
        "custom" => GenerateParams {
            temperature: 0.1,
            system: Some(FAITHFUL_SYSTEM.into()),
        },
        "translate" => GenerateParams {
            temperature: 0.15,
            system: Some(FAITHFUL_SYSTEM.into()),
        },
        "reformulate" => GenerateParams {
            temperature: 0.25,
            system: Some(FAITHFUL_SYSTEM.into()),
        },
        "summarize" => GenerateParams {
            temperature: 0.3,
            system: Some(FAITHFUL_SYSTEM.into()),
        },
        _ => GenerateParams {
            temperature: 0.2,
            system: Some(FAITHFUL_SYSTEM.into()),
        },
    }
}

fn looks_like_format_instruction(instruction: &str) -> bool {
    let t = instruction.to_lowercase();
    [
        "markdown",
        "balise",
        "interprete",
        "interprète",
        "mise en forme",
        "mettre en forme",
        "formater",
        "formatage",
        "outline",
        "table des",
        "wikilink",
        "titre",
        "bloc de code",
        "code fence",
        "docker",
        "compose",
    ]
    .iter()
    .any(|k| t.contains(k))
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
            description: "Embeddings pour recherche sémantique (RAG)".into(),
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
    if !cli_installed() && find_ollama_app().is_none() {
        return Err("Ollama n'est pas installé. Installez-le depuis Réglages.".into());
    }

    #[cfg(windows)]
    {
        if let Some(exe) = find_ollama_app() {
            std::process::Command::new(&exe)
                .spawn()
                .map_err(|e| format!("Impossible de lancer Ollama : {e}"))?;
        } else {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", "ollama", "app"])
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        if cli_installed() {
            let mut serve = std::process::Command::new("ollama");
            serve.arg("serve");
            #[cfg(windows)]
            serve.creation_flags(0x08000000);
            let _ = serve.spawn();
        }

        return Ok("Ollama lancé. Attendez quelques secondes…".into());
    }

    #[cfg(not(windows))]
    {
        if let Some(exe) = find_ollama_app() {
            std::process::Command::new(&exe)
                .arg("serve")
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("ollama")
                .arg("serve")
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        return Ok("Démarrage d'Ollama demandé.".into());
    }
}

#[cfg(windows)]
fn find_ollama_app() -> Option<std::path::PathBuf> {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let candidate = std::path::PathBuf::from(local)
            .join("Programs")
            .join("Ollama")
            .join("Ollama.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    if let Ok(output) = Command::new("where").arg("ollama").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() {
                let cli_path = std::path::PathBuf::from(&path);
                if let Some(dir) = cli_path.parent() {
                    let gui = dir.join("Ollama.exe");
                    if gui.exists() {
                        return Some(gui);
                    }
                }
                return Some(cli_path);
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn find_ollama_app() -> Option<std::path::PathBuf> {
    Command::new("which")
        .arg("ollama")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .map(|p| std::path::PathBuf::from(p.trim()))
        })
}

async fn ollama_generate_with(
    prompt: String,
    model: Option<String>,
    params: GenerateParams,
) -> Result<String, String> {
    let config = load_config();
    let host = config.ollama_host.trim_end_matches('/').to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let model = model.unwrap_or(config.selected_model);

    let body = OllamaRequest {
        model,
        prompt,
        stream: false,
        system: params.system,
        options: Some(OllamaGenOptions {
            temperature: params.temperature,
            top_p: Some(0.9),
            num_ctx: Some(8192),
        }),
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
pub async fn ollama_custom_prompt(
    instruction: String,
    content: String,
    model: Option<String>,
    note_context: Option<String>,
    rag_context: Option<String>,
) -> Result<String, String> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("Le prompt personnalisé est vide.".into());
    }

    let context_block = format_note_context(note_context.as_deref());
    let rag_block = format_rag_block(rag_context.as_deref());
    let format_rules = if looks_like_format_instruction(instruction) {
        "\nRègles Markdown (obligatoires) :\n\
         - Répare uniquement la structure (titres, listes, liens, blocs de code).\n\
         - Ne change pas le sujet ni le fond : pas d'exemple générique à la place du texte.\n\
         - Conserve INTÉGRALEMENT chaque ligne à l'intérieur des blocs ``` (yaml, chemins, env).\n\
         - N'ouvre/ferme JAMAIS une fence au milieu d'un compose — un service = un seul bloc.\n\
         - Titre vide `##` → déduis le nom depuis le service docker du bloc suivant.\n\
         - Fence nue ``` avec version/services/image → ```yaml.\n\
         - Supprime les stubs `##` + fence vides en fin de fichier.\n\
         - Table des matières / outline = liste de liens Markdown HORS des blocs de code.\n\
         - Un résumé éventuel = section séparée, jamais collé en fin de ligne.\n\
         - Si tu entoures la réponse, une seule fence ```markdown autour du document entier.\n"
    } else {
        "\nNe remplace pas le texte par un autre document. Conserve le sujet et les informations.\n"
    };
    let prompt = format!(
        "Tu édites une note existante.{context_block}{rag_block}\n\
         {format_rules}\n\
         Consigne de l'utilisateur :\n{instruction}\n\n\
         Texte à traiter (source unique de vérité) :\n---\n{content}\n---\n\n\
         Réponds uniquement avec le texte transformé, sans introduction ni commentaire."
    );

    ollama_generate_with(prompt, model, generate_params("custom"))
        .await
        .map(|raw| sanitize_ai_response(&raw, "custom", &content))
}

#[tauri::command]
pub async fn ollama_summarize_note(
    content: String,
    model: Option<String>,
    note_context: Option<String>,
    rag_context: Option<String>,
) -> Result<String, String> {
    let context_block = format_note_context(note_context.as_deref());
    let rag_block = format_rag_block(rag_context.as_deref());
    let prompt = format!(
        "Tu es un assistant de prise de notes.{context_block}{rag_block}\n\
         Résume UNIQUEMENT le passage ci-dessous en français, en 3 à 5 phrases concises.\n\
         Règles : pas de « Voici… », pas de liste à puces, pas de méta, pas de titre.\n\
         Ne répète pas le titre. N'utilise le RAG que s'il éclaire CE passage ;\n\
         n'importe jamais un autre sujet.\n\n---\n{content}\n---"
    );
    ollama_generate_with(prompt, model, generate_params("summarize")).await
}

#[tauri::command]
pub async fn ollama_transform_note(
    action: String,
    content: String,
    model: Option<String>,
    note_context: Option<String>,
    target_language: Option<String>,
    rag_context: Option<String>,
) -> Result<String, String> {
    let context_block = format_note_context(note_context.as_deref());
    let rag_block = format_rag_block(rag_context.as_deref());
    let prompt = match action.as_str() {
        "reformulate" => format!(
            "Reformule ce texte en français, plus clair et fluide, sans changer le SENS ni le SUJET.\
             {context_block}{rag_block} \
             N'invente rien, n'importe aucun autre thème. \
             Réponds uniquement avec le texte reformulé.\n\n{content}"
        ),
        "correct" => format!(
            "Corrige l'orthographe et la grammaire du texte ci-dessous en tenant compte du SENS de la phrase.\n\
             Règles STRICTES :\n\
             - Réponds avec le texte corrigé SEUL, sans introduction ni commentaire\n\
             - Pas de guillemets, pas de « Voici… »\n\
             - N'ajoute AUCUN mot, phrase ou idée\n\
             - Ne reformule pas, ne résume pas, ne paraphrase pas\n\
             - Ignore tout contexte externe à ce passage\n\
             - Si un mot ressemble à un mot français mais n'a pas de sens dans la phrase \
               (ex. « fère » après « encore »), choisis le mot qui convient (ex. « faire »)\n\
             - Corrige TOUTES les fautes du passage, pas seulement une partie\n\
             - Même sens exact, structure proche\n\n{content}"
        ),
        "translate" | "translate_en" | "translate_de" | "translate_es" | "translate_it"
        | "translate_pt" | "translate_nl" => {
            let lang = target_language
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| match action.as_str() {
                    "translate_de" => "allemand".into(),
                    "translate_es" => "espagnol".into(),
                    "translate_it" => "italien".into(),
                    "translate_pt" => "portugais".into(),
                    "translate_nl" => "néerlandais".into(),
                    _ => "anglais".into(),
                });
            format!(
                "Traduis ce texte en {lang}.{context_block} \
                 Réponds uniquement avec la traduction complète, sans commentaire ni balises.\n\n{content}"
            )
        }
        _ => return Err(format!("Action IA inconnue : {action}")),
    };
    let _ = rag_block; // translate ignore le RAG volontairement
    let kind = if action.starts_with("translate") {
        "translate"
    } else {
        action.as_str()
    };
    ollama_generate_with(prompt, model, generate_params(kind))
        .await
        .map(|raw| sanitize_ai_response(&raw, &action, &content))
}

/// Unwrap only a whole-document ```markdown wrapper, never the first inner code fence.
fn unwrap_outer_markdown_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.is_empty() {
        return trimmed.to_string();
    }
    let lang = lines[0]
        .trim()
        .trim_start_matches('`')
        .trim()
        .to_lowercase();
    let is_wrapper = lang.is_empty()
        || lang == "markdown"
        || lang == "md"
        || lang == "text"
        || lang == "txt"
        || lang == "plaintext";
    if !is_wrapper {
        return trimmed.to_string();
    }
    let last_nonempty = lines.iter().rposition(|l| !l.trim().is_empty());
    let Some(end) = last_nonempty else {
        return trimmed.to_string();
    };
    if end < 1 || !lines[end].trim().starts_with("```") {
        return trimmed.to_string();
    }
    let mut next = lines[1..end].join("\n").trim().to_string();
    if fence_unclosed(&next) {
        next.push_str("\n```");
    }
    next
}

fn fence_unclosed(md: &str) -> bool {
    let mut open = false;
    for line in md.lines() {
        if line.trim().starts_with("```") {
            open = !open;
        }
    }
    open
}

fn sanitize_ai_response(raw: &str, action: &str, original: &str) -> String {
    let mut text = unwrap_outer_markdown_fence(raw);

    let lower = text.to_lowercase();
    for marker in [
        "voici le texte corrigé",
        "voici le texte reformulé",
        "voici la traduction",
        "je vais essayer",
        "texte corrigé :",
        "texte reformulé :",
    ] {
        if let Some(idx) = lower.find(marker) {
            let tail = text[idx..].splitn(2, ':').nth(1).unwrap_or("").trim();
            if tail.len() > 8 {
                text = tail.to_string();
                break;
            }
        }
    }

    if action != "custom" {
        text = text
            .trim()
            .trim_matches('"')
            .trim_matches('«')
            .trim_matches('»')
            .to_string();
    }

    if action == "correct" {
        let orig_words = original.split_whitespace().count();
        let out_words = text.split_whitespace().count();
        if orig_words > 0 && out_words > orig_words + orig_words / 2 + 3 {
            return original.to_string();
        }
    }

    if text.is_empty() {
        original.to_string()
    } else {
        text
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveSuggestion {
    pub suggest: bool,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub proposed: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn ollama_proactive_suggest(
    paragraph: String,
    note_excerpt: Option<String>,
    note_context: Option<String>,
    model: Option<String>,
) -> Result<ProactiveSuggestion, String> {
    if paragraph.trim().len() < 12 {
        return Ok(ProactiveSuggestion {
            suggest: false,
            label: None,
            proposed: None,
            reason: None,
        });
    }

    let context_block = format_note_context(note_context.as_deref());
    let excerpt_block = note_excerpt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|excerpt| format!("\n\nExtrait de la note (contexte global) :\n---\n{excerpt}\n---"))
        .unwrap_or_default();

    let prompt = format!(
        "Tu es un correcteur orthographique discret dans une app de notes.{context_block}\
         Analyse UNIQUEMENT le passage ci-dessous.{excerpt_block}\n\n\
         Passage :\n---\n{paragraph}\n---\n\n\
         Propose UNIQUEMENT une correction d'orthographe / grammaire si nécessaire.\n\
         INTERDIT : reformuler, traduire, paraphraser, changer le style ou le sens,\n\
         ajouter des idées, réécrire dans une autre langue.\n\n\
         S'il y a des fautes :\n\
         {{\"suggest\":true,\"label\":\"Correction\",\"proposed\":\"...\",\"reason\":\"...\"}}\n\
         - \"proposed\" = la MÊME phrase, mêmes mots autant que possible, juste corrigée\n\
         - longueur très proche de l'original\n\n\
         Sinon (texte déjà correct, autre langue, style volontaire) : {{\"suggest\":false}}\n\
         Pas de markdown, pas de texte hors JSON."
    );

    let raw = ollama_generate_with(prompt, model, generate_params("proactive")).await?;
    let mut parsed = parse_proactive_response(&raw);
    if parsed.suggest {
        if let Some(raw_proposed) = parsed.proposed.take() {
            let label_l = parsed
                .label
                .as_deref()
                .unwrap_or("")
                .to_lowercase();
            // Plus de reformulation proactive : trop de dérive de sens
            if label_l.contains("reform") {
                parsed.suggest = false;
                parsed.proposed = None;
                parsed.reason = None;
                parsed.label = None;
            } else {
                let action = "correct";
                let proposed = sanitize_ai_response(&raw_proposed, action, &paragraph);
                let reject = proposed.trim().is_empty()
                    || proposed.trim() == paragraph.trim()
                    || (paragraph.split_whitespace().count() > 0
                        && proposed.split_whitespace().count()
                            > paragraph.split_whitespace().count() + 2)
                    || !is_faithful_enough(&paragraph, &proposed);

                if reject {
                    parsed.suggest = false;
                    parsed.reason = None;
                } else {
                    parsed.proposed = Some(proposed);
                    parsed.label = Some("Correction".into());
                }
            }
        } else {
            parsed.suggest = false;
        }
    }
    Ok(parsed)
}

/** Heuristique anti-dérive : une « correction » doit ressembler à l'original. */
fn is_faithful_enough(original: &str, proposed: &str) -> bool {
    let o = original.trim();
    let p = proposed.trim();
    if o.is_empty() || p.is_empty() {
        return false;
    }
    let o_words: Vec<&str> = o.split_whitespace().collect();
    let p_words: Vec<&str> = p.split_whitespace().collect();
    if p_words.len() > o_words.len() + 2 {
        return false;
    }
    if (p.len() as f32) > (o.len() as f32) * 1.4 + 8.0 {
        return false;
    }
    let p_lower: Vec<String> = p_words.iter().map(|w| w.to_lowercase()).collect();
    let mut matched = 0usize;
    for w in &o_words {
        let nw = w.to_lowercase();
        if p_lower.iter().any(|pw| pw == &nw) {
            matched += 1;
            continue;
        }
        let prefix: String = nw.chars().take(2).collect();
        if prefix.len() >= 2
            && p_lower.iter().any(|pw| {
                pw.starts_with(&prefix) && (pw.len() as i32 - nw.len() as i32).abs() <= 3
            })
        {
            matched += 1;
        }
    }
    if o_words.is_empty() {
        return false;
    }
    (matched as f32) / (o_words.len() as f32) >= 0.45
}

fn parse_proactive_response(raw: &str) -> ProactiveSuggestion {
    let trimmed = raw.trim();
    let json_body = if trimmed.starts_with("```") {
        trimmed
            .lines()
            .skip(1)
            .take_while(|line| !line.trim().starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            trimmed[start..=end].to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    if let Ok(parsed) = serde_json::from_str::<ProactiveSuggestion>(&json_body) {
        if parsed.suggest {
            let has_proposed = parsed
                .proposed
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .is_some();
            if has_proposed {
                return parsed;
            }
        }
        return ProactiveSuggestion {
            suggest: false,
            label: None,
            proposed: None,
            reason: None,
        };
    }

    ProactiveSuggestion {
        suggest: false,
        label: None,
        proposed: None,
        reason: None,
    }
}

fn format_note_context(note_context: Option<&str>) -> String {
    let Some(ctx) = note_context.map(str::trim).filter(|c| !c.is_empty()) else {
        return String::new();
    };
    format!(
        " Contexte / objectif de la note : {ctx}. Respecte cet objectif dans ta réponse."
    )
}

fn format_rag_block(rag_context: Option<&str>) -> String {
    match rag_context.map(str::trim).filter(|s| !s.is_empty()) {
        Some(rag) => format!(
            "\n\nExtraits d'autres notes (optionnels). IGNORE-LES s'ils parlent d'un autre sujet que le texte à traiter.\n{rag}\n"
        ),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_keeps_yaml_fence_as_content() {
        let raw = "```yaml\nservices:\n  web:\n    image: nginx\n```\n\n# Suite";
        assert_eq!(unwrap_outer_markdown_fence(raw), raw);
    }

    #[test]
    fn unwrap_outer_markdown_preserves_inner_code() {
        let raw = "```markdown\n# Docker\n\n```yaml\nservices:\n  web:\n```\n```";
        let out = unwrap_outer_markdown_fence(raw);
        assert!(out.contains("# Docker"));
        assert!(out.contains("```yaml"));
        assert!(out.contains("image") || out.contains("services:"));
    }

    #[test]
    fn format_instruction_detects_markdown() {
        assert!(looks_like_format_instruction(
            "Mets en forme correctement les balises markdown"
        ));
        assert!(!looks_like_format_instruction("Raccourcis en deux phrases"));
    }

    #[test]
    fn custom_sanitize_does_not_chop_inner_fences() {
        let raw = "```markdown\n# Stacks\n\n- [web](#web)\n\n```yaml\nservices:\n  web:\n    image: nginx\n```\n```";
        let out = sanitize_ai_response(raw, "custom", "services web nginx");
        assert!(out.contains("```yaml"));
        assert!(out.contains("# Stacks"));
        assert!(out.contains("- [web](#web)"));
    }
}

