import pkg from "../../package.json";

/** Version affichée dans l'UI — source : package.json (sync avec tauri.conf.json / Cargo.toml). */
export const APP_VERSION = pkg.version;

export const APP_NAME = "CyberScribeNote";

export const APP_REPO_URL = "https://github.com/nico2511/CyberScribeNote";

export const APP_BTC_DONATION =
  "bc1pt20cczcmvukrny4pru3x2nc522tk2sectlu22d42q2ltyau7t66suh6kqx";
