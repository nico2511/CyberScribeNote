//! Import de documents via Microsoft MarkItDown (Python).
//! https://github.com/microsoft/markitdown

use crate::commands::vault::{ensure_vault, resolve_path, sanitize_name};
use crate::fs_util::atomic_write;
use crate::voice_util::{find_python, hidden_command};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};

const MAX_MARKITDOWN_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "html", "htm", "epub", "csv",
    "json", "xml", "rtf", "odt", "msg", "eml", "zip",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkitdownStatus {
    pub python_found: bool,
    pub python_path: String,
    pub deps_ok: bool,
    pub script_path: String,
    pub error: Option<String>,
}

fn tools_dir(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("tools"));
            candidates.push(resource_dir.join("..").join("tools"));
        }
        if let Ok(exe) = app.path().executable_dir() {
            candidates.push(exe.join("tools"));
            candidates.push(exe.join("..").join("tools"));
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("../tools"));
    candidates.push(manifest.join("../../tools"));

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("tools"));
        candidates.push(cwd.join("../tools"));
    }

    for dir in candidates {
        let script = dir.join("markitdown_convert.py");
        if script.is_file() {
            return Ok(dir);
        }
    }

    Err(
        "tools/markitdown_convert.py introuvable. Vérifiez le dossier tools/ à la racine du projet."
            .into(),
    )
}

fn convert_script(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("markitdown_convert.py"))
}

fn requirements_file(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    let path = tools_dir(app)?.join("requirements-markitdown.txt");
    if !path.is_file() {
        return Err(format!(
            "requirements-markitdown.txt introuvable dans {}",
            path.parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default()
        ));
    }
    Ok(path)
}

fn is_supported_extension(ext: &str) -> bool {
    SUPPORTED_EXTENSIONS
        .iter()
        .any(|e| e.eq_ignore_ascii_case(ext))
}

/// Convertit un fichier local en Markdown via le script Python MarkItDown.
pub fn convert_file_to_markdown(app: Option<&AppHandle>, source: &Path) -> Result<String, String> {
    if !source.is_file() {
        return Err(format!("Fichier introuvable : {}", source.display()));
    }
    if !source.is_absolute() {
        return Err("Le chemin source doit être absolu.".into());
    }

    let python = find_python().ok_or_else(|| {
        "Python 3.10+ introuvable. Installez Python ou utilisez Réglages → Import documents."
            .to_string()
    })?;
    let script = convert_script(app)?;

    let mut cmd = hidden_command(&python);
    cmd.arg(&script)
        .arg(source)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("Impossible de lancer MarkItDown ({python}) : {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if err.is_empty() {
            return Err(format!(
                "MarkItDown a échoué (code {}).",
                output.status.code().unwrap_or(-1)
            ));
        }
        return Err(err);
    }

    if output.stdout.len() > MAX_MARKITDOWN_OUTPUT_BYTES {
        return Err(format!(
            "Résultat trop volumineux (> {} Mo).",
            MAX_MARKITDOWN_OUTPUT_BYTES / (1024 * 1024)
        ));
    }

    let text = String::from_utf8(output.stdout)
        .map_err(|_| "La conversion a produit du texte non UTF-8.".to_string())?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let text = text.trim().to_string();
    if text.is_empty() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Conversion vide.".into()
        } else {
            err
        });
    }
    Ok(text)
}

#[tauri::command]
pub fn markitdown_status(app: AppHandle) -> Result<MarkitdownStatus, String> {
    let script = convert_script(Some(&app))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let Some(python) = find_python() else {
        return Ok(MarkitdownStatus {
            python_found: false,
            python_path: String::new(),
            deps_ok: false,
            script_path: script,
            error: Some(
                "Python introuvable. Installez Python 3.10+ pour importer PDF / Office → Markdown."
                    .into(),
            ),
        });
    };

    if script.is_empty() {
        return Ok(MarkitdownStatus {
            python_found: true,
            python_path: python,
            deps_ok: false,
            script_path: String::new(),
            error: Some("Script markitdown_convert.py introuvable.".into()),
        });
    }

    let mut cmd = hidden_command(&python);
    let check = cmd
        .arg("-c")
        .arg("import markitdown; print('ok')")
        .output();

    match check {
        Ok(output) if output.status.success() => Ok(MarkitdownStatus {
            python_found: true,
            python_path: python,
            deps_ok: true,
            script_path: script,
            error: None,
        }),
        Ok(output) => Ok(MarkitdownStatus {
            python_found: true,
            python_path: python,
            deps_ok: false,
            script_path: script,
            error: Some(format!(
                "MarkItDown non installé. pip install -r tools/requirements-markitdown.txt\n{}",
                String::from_utf8_lossy(&output.stderr).trim()
            )),
        }),
        Err(e) => Ok(MarkitdownStatus {
            python_found: true,
            python_path: python,
            deps_ok: false,
            script_path: script,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub fn markitdown_install_deps(app: AppHandle) -> Result<String, String> {
    let python = find_python().ok_or("Python introuvable")?;
    let req = requirements_file(Some(&app))?;

    let mut cmd = hidden_command(&python);
    let output = cmd
        .args(["-m", "pip", "install", "-r"])
        .arg(&req)
        .output()
        .map_err(|e| format!("pip échoué : {e}"))?;

    if output.status.success() {
        Ok("MarkItDown installé — vous pouvez importer PDF, Word, HTML…".into())
    } else {
        Err(format!(
            "Installation pip échouée :\n{}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[tauri::command]
pub fn import_documents(
    app: AppHandle,
    paths: Vec<String>,
    parent_path: String,
) -> Result<Vec<String>, String> {
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
    let mut errors: Vec<String> = Vec::new();

    for raw in paths {
        let source = PathBuf::from(raw.trim());
        if !source.is_file() {
            errors.push(format!("Ignoré (introuvable) : {}", source.display()));
            continue;
        }
        if !source.is_absolute() {
            errors.push(format!("Ignoré (chemin relatif) : {}", source.display()));
            continue;
        }
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !is_supported_extension(&ext) {
            errors.push(format!(
                "Ignoré (extension .{ext} non supportée) : {}",
                source
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            ));
            continue;
        }

        let stem = source
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Document".into());
        let safe = sanitize_name(&stem).unwrap_or_else(|_| "Document_importe".into());
        let mut file_name = format!("{safe}.md");
        let mut dest = parent.join(&file_name);
        let mut n = 2;
        while dest.exists() {
            file_name = format!("{safe}-{n}.md");
            dest = parent.join(&file_name);
            n += 1;
        }

        let body = match convert_file_to_markdown(Some(&app), &source) {
            Ok(b) => b,
            Err(e) => {
                errors.push(format!(
                    "{} : {e}",
                    source
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| source.display().to_string())
                ));
                continue;
            }
        };

        let title = safe.replace('_', " ");
        let source_name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
            .replace('"', "'");
        let content = if body.trim_start().starts_with("---") {
            body
        } else {
            format!(
                "---\ntitle: {title}\ntags: [import, markitdown]\nsource: {source_name}\ncreated: {}\n---\n\n# {title}\n\n{body}\n",
                chrono::Local::now().format("%Y-%m-%d"),
            )
        };

        if content.len() > MAX_MARKITDOWN_OUTPUT_BYTES + 2048 {
            errors.push(format!("{file_name} : résultat trop volumineux"));
            continue;
        }

        atomic_write(&dest, content.as_bytes())?;
        let relative = dest
            .strip_prefix(&root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        created.push(relative);
    }

    if created.is_empty() {
        let detail = if errors.is_empty() {
            "Aucun document importé.".into()
        } else {
            format!("Aucun document importé.\n{}", errors.join("\n"))
        };
        return Err(detail);
    }

    let _ = errors;
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::is_supported_extension;

    #[test]
    fn supports_common_office_and_web() {
        assert!(is_supported_extension("pdf"));
        assert!(is_supported_extension("DOCX"));
        assert!(is_supported_extension("html"));
        assert!(!is_supported_extension("exe"));
        assert!(!is_supported_extension("md"));
    }
}
