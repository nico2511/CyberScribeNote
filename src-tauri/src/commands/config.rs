use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub ollama_host: String,
    pub selected_model: String,
    #[serde(default = "default_voice_hotkey")]
    pub voice_hotkey: String,
    #[serde(default = "default_whisper_language")]
    pub whisper_language: String,
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
    #[serde(default = "default_whisper_device")]
    pub whisper_device: String,
    #[serde(default = "default_whisper_compute_type")]
    pub whisper_compute_type: String,
    #[serde(default = "default_whisper_profile")]
    pub whisper_profile: String,
    #[serde(default = "default_max_record_seconds")]
    pub max_record_seconds: u32,
}

fn default_voice_hotkey() -> String {
    "F8".into()
}
fn default_whisper_language() -> String {
    "fr".into()
}
fn default_whisper_model() -> String {
    "base".into()
}
fn default_whisper_device() -> String {
    "auto".into()
}
fn default_whisper_compute_type() -> String {
    "int8".into()
}
fn default_whisper_profile() -> String {
    "fast".into()
}
fn default_max_record_seconds() -> u32 {
    25
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ollama_host: "http://127.0.0.1:11434".to_string(),
            selected_model: "llama3.2".to_string(),
            voice_hotkey: default_voice_hotkey(),
            whisper_language: default_whisper_language(),
            whisper_model: default_whisper_model(),
            whisper_device: default_whisper_device(),
            whisper_compute_type: default_whisper_compute_type(),
            whisper_profile: default_whisper_profile(),
            max_record_seconds: default_max_record_seconds(),
        }
    }
}

fn config_dir() -> Result<PathBuf, String> {
    dirs::document_dir()
        .map(|d| d.join("CyberScribeNote"))
        .ok_or_else(|| "Impossible de trouver le dossier Documents".into())
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load_config() -> AppConfig {
    config_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_app_config() -> Result<AppConfig, String> {
    Ok(load_config())
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
