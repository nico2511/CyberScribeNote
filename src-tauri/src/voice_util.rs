use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Résout un interpréteur Python utilisable (chemin absolu privilégié).
pub fn find_python() -> Option<String> {
    // Préférer le vrai python.exe (pas le lanceur `py`) pour un sidecar stable.
    for candidate in ["python", "python3", "py"] {
        let mut probe = hidden_command(candidate);
        if candidate == "py" {
            probe.args(["-3", "-c", "import sys; print(sys.executable)"]);
        } else {
            probe.args(["-c", "import sys; print(sys.executable)"]);
        }
        if let Ok(output) = probe.output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() && Path::new(&path).exists() {
                    return Some(path);
                }
                if candidate != "py" {
                    return Some(candidate.to_string());
                }
            }
        }
    }
    None
}
