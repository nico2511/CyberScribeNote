use crate::commands::config::load_config;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static VOICE_RESTART_GUARD: Mutex<Option<Instant>> = Mutex::new(None);

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    pub voice_hotkey: String,
    pub whisper_language: String,
    pub whisper_model: String,
    pub whisper_device: String,
    pub whisper_compute_type: String,
    pub whisper_profile: String,
    pub max_record_seconds: u32,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            voice_hotkey: "F8".to_string(),
            whisper_language: "fr".to_string(),
            whisper_model: "base".to_string(),
            whisper_device: "auto".to_string(),
            whisper_compute_type: "int8".to_string(),
            whisper_profile: "fast".to_string(),
            max_record_seconds: 90,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceDepsStatus {
    pub python_found: bool,
    pub python_path: String,
    pub deps_ok: bool,
    pub worker_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub running: bool,
    pub recording: bool,
    pub transcribing: bool,
    pub model_loaded: bool,
    pub model_loading: bool,
    pub deps_ok: bool,
    pub hotkey: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTranscript {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperCacheEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

pub struct VoiceState {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    status: VoiceStatus,
    generation: u64,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            child: None,
            stdin: None,
            status: VoiceStatus {
                running: false,
                recording: false,
                transcribing: false,
                model_loaded: false,
                model_loading: false,
                deps_ok: false,
                hotkey: VoiceConfig::default().voice_hotkey.clone(),
                error: None,
            },
            generation: 0,
        }
    }
}

pub fn whisper_models_dir() -> PathBuf {
    dirs::document_dir()
        .map(|d| d.join("CyberScribeNote").join("models"))
        .unwrap_or_else(|| PathBuf::from("models"))
}

impl VoiceState {
    pub fn worker_script_path(app: Option<&AppHandle>) -> Result<PathBuf, String> {
        if let Some(handle) = app {
            if let Ok(resource_dir) = handle.path().resource_dir() {
                for candidate in [
                    resource_dir.join("voice_worker.py"),
                    resource_dir.join("voice").join("voice_worker.py"),
                ] {
                    if candidate.exists() {
                        return Ok(candidate);
                    }
                }
            }
        }

        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../voice/voice_worker.py");
        if dev_path.exists() {
            return Ok(dev_path.canonicalize().unwrap_or(dev_path));
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let candidates = [
                    parent.join("voice/voice_worker.py"),
                    parent.join("voice_worker.py"),
                    parent.join("../../voice/voice_worker.py"),
                    parent.join("../../../voice/voice_worker.py"),
                ];
                for candidate in candidates {
                    if candidate.exists() {
                        return Ok(candidate.canonicalize().unwrap_or(candidate));
                    }
                }
            }
        }

        Err(
            "voice_worker.py introuvable. Vérifiez le dossier voice/ à la racine du projet."
                .into(),
        )
    }

    fn find_python() -> Option<String> {
        for candidate in ["py", "python", "python3"] {
            let mut cmd = hidden_command(candidate);
            if candidate == "py" {
                cmd.arg("-3");
            }
            cmd.arg("--version");
            if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
                return Some(candidate.to_string());
            }
        }
        None
    }

    pub fn check_deps(app: Option<&AppHandle>) -> VoiceDepsStatus {
        let worker_path = Self::worker_script_path(app)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let Some(python) = Self::find_python() else {
            return VoiceDepsStatus {
                python_found: false,
                python_path: String::new(),
                deps_ok: false,
                worker_path,
                error: Some("Python introuvable (installez Python 3.10+)".into()),
            };
        };

        let mut cmd = hidden_command(&python);
        if python == "py" {
            cmd.arg("-3");
        }
        let check = cmd
            .arg("-c")
            .arg("import pyaudio, faster_whisper")
            .output();

        match check {
            Ok(output) if output.status.success() => VoiceDepsStatus {
                python_found: true,
                python_path: python,
                deps_ok: true,
                worker_path,
                error: None,
            },
            Ok(output) => VoiceDepsStatus {
                python_found: true,
                python_path: python,
                deps_ok: false,
                worker_path,
                error: Some(format!(
                    "Dépendances manquantes. pip install -r voice/requirements.txt\n{}",
                    String::from_utf8_lossy(&output.stderr)
                )),
            },
            Err(e) => VoiceDepsStatus {
                python_found: true,
                python_path: python,
                deps_ok: false,
                worker_path,
                error: Some(e.to_string()),
            },
        }
    }

    fn voice_config_json(voice: &VoiceConfig) -> serde_json::Value {
        serde_json::json!({
            "language": voice.whisper_language,
            "model_size": voice.whisper_model,
            "device": voice.whisper_device,
            "compute_type": voice.whisper_compute_type,
            "transcription_profile": voice.whisper_profile,
            "max_record_seconds": voice.max_record_seconds,
        })
    }

    fn is_worker_alive(&mut self) -> bool {
        let Some(child) = self.child.as_mut() else {
            return false;
        };
        match child.try_wait() {
            Ok(Some(_)) => false,
            Ok(None) => self.stdin.is_some(),
            Err(_) => false,
        }
    }

    fn bump_generation(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    fn mark_worker_stopped(&mut self) {
        self.stdin = None;
        self.child = None;
        self.status.running = false;
        self.status.recording = false;
        self.status.transcribing = false;
        self.status.model_loading = false;
        self.status.model_loaded = false;
    }

    fn send_cmd(&mut self, payload: serde_json::Value) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or("Worker vocal non démarré. Ouvrez Réglages → Voix.")?;
        let line = payload.to_string() + "\n";
        match stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()) {
            Ok(()) => Ok(()),
            Err(e) => {
                // Ne drop pas tout de suite le child : vérifier s'il est vraiment mort.
                let dead = self
                    .child
                    .as_mut()
                    .and_then(|c| c.try_wait().ok().flatten())
                    .is_some()
                    || self.child.is_none();
                if dead {
                    self.mark_worker_stopped();
                }
                Err(format!("Worker vocal déconnecté : {e}"))
            }
        }
    }

    pub fn stop_worker(&mut self) {
        self.bump_generation();
        if let Some(stdin) = self.stdin.as_mut() {
            let _ = stdin.write_all(b"{\"cmd\":\"shutdown\"}\n");
            let _ = stdin.flush();
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.stdin = None;
        self.mark_worker_stopped();
    }

    pub fn start_worker(&mut self, app: &AppHandle, voice: &VoiceConfig) -> Result<(), String> {
        self.stop_worker();

        let script = Self::worker_script_path(Some(app))?;
        let python = Self::find_python().ok_or("Python introuvable")?;

        let mut cmd = hidden_command(&python);
        if python == "py" {
            cmd.arg("-3");
        }
        cmd.arg("-u").arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Impossible de lancer le worker : {e}"))?;
        let stdin = child.stdin.take().ok_or("stdin worker indisponible")?;
        let stdout = child.stdout.take().ok_or("stdout worker indisponible")?;
        let stderr = child.stderr.take();

        let generation = self.generation;
        self.stdin = Some(stdin);
        self.child = Some(child);
        self.status.running = true;
        self.status.model_loaded = false;
        self.status.model_loading = false;
        self.status.hotkey = voice.voice_hotkey.clone();
        self.status.error = None;

        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                    handle_worker_event(&app_handle, json);
                }
            }
            let unexpected = if let Some(state) = app_handle.try_state::<Arc<Mutex<VoiceState>>>() {
                if let Ok(mut guard) = state.lock() {
                    if guard.generation != generation {
                        false
                    } else {
                        guard.mark_worker_stopped();
                        guard.status.error = Some(
                            "Worker vocal arrêté inopinément.".into(),
                        );
                        true
                    }
                } else {
                    false
                }
            } else {
                false
            };
            if unexpected {
                let _ = app_handle.emit("voice-worker-stopped", ());
            }
        });

        if let Some(stderr) = stderr {
            let app_handle = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let _ = app_handle.emit(
                        "voice-event",
                        serde_json::json!({
                            "type": "stderr",
                            "message": trimmed
                        }),
                    );
                }
            });
        }

        self.init_worker(voice)
    }

    fn init_worker(&mut self, voice: &VoiceConfig) -> Result<(), String> {
        self.send_cmd(serde_json::json!({
            "cmd": "init",
            "config": Self::voice_config_json(voice),
        }))
    }

    pub fn preload_whisper(&mut self, voice: &VoiceConfig) -> Result<(), String> {
        self.send_cmd(serde_json::json!({
            "cmd": "preload",
            "config": Self::voice_config_json(voice),
        }))
    }

    pub fn ensure_worker(&mut self, app: &AppHandle) -> Result<bool, String> {
        if self.is_worker_alive() {
            return Ok(false);
        }
        let voice = voice_config_from_app();
        self.start_worker(app, &voice)?;
        Ok(true)
    }

    pub fn toggle(&mut self, app: &AppHandle) -> Result<(), String> {
        let restarted = self.ensure_worker(app)?;
        if restarted {
            return Err(
                "Worker vocal redémarré — attendez le chargement du modèle Whisper, puis réessayez."
                    .into(),
            );
        }
        if self.status.model_loading {
            return Err("Chargement du modèle Whisper en cours — patientez.".into());
        }
        // On autorise l'enregistrement même si le modèle charge encore un peu :
        // la transcription attendra. Mais pas si le modèle a clairement échoué.
        if !self.status.model_loaded && self.status.error.is_some() {
            return Err(
                self.status
                    .error
                    .clone()
                    .unwrap_or_else(|| "Modèle Whisper non prêt.".into()),
            );
        }
        self.send_cmd(serde_json::json!({"cmd": "toggle"}))
    }
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

fn dir_size(path: &Path) -> u64 {
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

fn handle_worker_event(app: &AppHandle, json: serde_json::Value) {
    let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if let Some(state) = app.try_state::<Arc<Mutex<VoiceState>>>() {
        if let Ok(mut guard) = state.lock() {
            match event_type {
                "recording" => {
                    guard.status.recording =
                        json.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                }
                "transcribing" => {
                    guard.status.transcribing =
                        json.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                }
                "model" => {
                    guard.status.model_loading =
                        json.get("loading").and_then(|v| v.as_bool()).unwrap_or(false);
                    guard.status.model_loaded =
                        json.get("loaded").and_then(|v| v.as_bool()).unwrap_or(false);
                }
                "deps" => {
                    guard.status.deps_ok =
                        json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                }
                "error" => {
                    // Les messages "transcription en cours" ne sont pas fatals
                    let mut msg = json
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    if let Some(ref m) = msg {
                        if m.contains("Transcription encore en cours")
                            || m.contains("Chargement")
                        {
                            // info seulement — ne bloque pas les dictées suivantes
                            msg = None;
                        }
                    }
                    guard.status.error = msg;
                }
                "transcript" => {
                    // Une dictée réussie efface l'erreur résiduelle (timeout, etc.)
                    let text = json.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    if !text.trim().is_empty() {
                        guard.status.error = None;
                    }
                }
                _ => {}
            }
        }
    }

    let _ = app.emit("voice-event", json.clone());

    if event_type == "transcript" {
        let text = json
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let _ = app.emit("voice-transcript", VoiceTranscript { text });
    }
}

pub fn voice_config_from_app() -> VoiceConfig {
    let cfg = load_config();
    VoiceConfig {
        voice_hotkey: cfg.voice_hotkey,
        whisper_language: cfg.whisper_language,
        whisper_model: cfg.whisper_model,
        whisper_device: cfg.whisper_device,
        whisper_compute_type: cfg.whisper_compute_type,
        whisper_profile: cfg.whisper_profile,
        max_record_seconds: cfg.max_record_seconds,
    }
}

pub fn parse_hotkey(raw: &str) -> Result<Shortcut, String> {
    let normalized = raw.trim().replace(' ', "");
    if normalized.is_empty() {
        return "F8".parse::<Shortcut>().map_err(|e| e.to_string());
    }
    normalized.parse::<Shortcut>().map_err(|e| e.to_string())
}

pub fn register_voice_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut: Shortcut = parse_hotkey(hotkey)?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(shortcut, move |app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        if let Some(state) = app.try_state::<Arc<Mutex<VoiceState>>>() {
            if let Ok(mut guard) = state.lock() {
                if let Err(e) = guard.toggle(app) {
                    guard.status.error = Some(e);
                }
            }
        }
    })
    .map_err(|e| format!("Impossible d'enregistrer {hotkey} : {e}"))
}

#[tauri::command]
pub fn voice_check_deps(app: AppHandle) -> VoiceDepsStatus {
    VoiceState::check_deps(Some(&app))
}

#[tauri::command]
pub fn voice_get_status(
    state: tauri::State<'_, Arc<Mutex<VoiceState>>>,
) -> Result<VoiceStatus, String> {
    state
        .lock()
        .map(|s| s.status.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_toggle(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<VoiceState>>>,
) -> Result<(), String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .toggle(&app)
}

#[tauri::command]
pub fn voice_preload_whisper_model(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<VoiceState>>>,
) -> Result<(), String> {
    let voice = voice_config_from_app();
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.ensure_worker(&app)?;
    guard.preload_whisper(&voice)
}

#[tauri::command]
pub fn voice_models_dir() -> Result<String, String> {
    let dir = whisper_models_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn voice_list_whisper_cache() -> Result<Vec<WhisperCacheEntry>, String> {
    let dir = whisper_models_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    scan_cache_dir(&dir, &dir, &mut entries, 0);
    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    entries.truncate(30);
    Ok(entries)
}

#[tauri::command]
pub fn voice_install_deps(app: AppHandle) -> Result<String, String> {
    let python = VoiceState::find_python().ok_or("Python introuvable")?;
    let worker_dir = VoiceState::worker_script_path(Some(&app))?
        .parent()
        .ok_or("Dossier voice introuvable")?
        .to_path_buf();
    let req_file = worker_dir.join("requirements.txt");
    if !req_file.exists() {
        return Err(format!(
            "requirements.txt introuvable dans {}",
            worker_dir.display()
        ));
    }

    let mut cmd = hidden_command(&python);
    if python == "py" {
        cmd.arg("-3");
    }
    let output = cmd
        .args(["-m", "pip", "install", "-r"])
        .arg(&req_file)
        .output()
        .map_err(|e| format!("pip échoué : {e}"))?;

    if output.status.success() {
        Ok("Dépendances vocales installées.".into())
    } else {
        Err(format!(
            "Installation pip échouée :\n{}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[tauri::command]
pub fn voice_restart(app: AppHandle, force: Option<bool>) -> Result<(), String> {
    restart_voice_internal(&app, force.unwrap_or(false))
}

fn restart_voice_internal(app: &AppHandle, force: bool) -> Result<(), String> {
    {
        let mut guard = VOICE_RESTART_GUARD
            .lock()
            .map_err(|e| e.to_string())?;
        if !force {
            if let Some(last) = *guard {
                if last.elapsed() < Duration::from_secs(8) {
                    return Ok(());
                }
            }
        }
        *guard = Some(Instant::now());
    }

    let voice = voice_config_from_app();
    let state = app.state::<Arc<Mutex<VoiceState>>>();
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.stop_worker();
        guard.start_worker(app, &voice)?;
    }
    register_voice_hotkey(app, &voice.voice_hotkey)
}

pub fn setup_voice(app: &AppHandle) -> Result<(), String> {
    restart_voice_internal(app, true)
}
