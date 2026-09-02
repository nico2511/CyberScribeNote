import pkg from "../../package.json";

/** Version affichée dans l'UI — source : package.json (sync avec tauri.conf.json / Cargo.toml). */
export const APP_VERSION = pkg.version;

export const APP_NAME = "CyberScribeNote";
