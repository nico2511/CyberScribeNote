export interface VaultEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: VaultEntry[];
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface OllamaStatus {
  available: boolean;
  models: string[];
  host: string;
  selectedModel: string;
  networkMode: string;
  isLocalhost: boolean;
  ollamaHostEnv?: string;
  networkGuidance?: string;
}

export interface OllamaDetect {
  cliInstalled: boolean;
  serviceRunning: boolean;
  host: string;
  selectedModel: string;
  networkMode: string;
  isLocalhost: boolean;
  ollamaHostEnv?: string;
  networkGuidance?: string;
}

export interface AppConfig {
  ollamaHost: string;
  selectedModel: string;
  voiceHotkey: string;
  whisperLanguage: string;
  whisperModel: string;
  whisperDevice: string;
  whisperComputeType: string;
  whisperProfile: string;
  maxRecordSeconds: number;
  /** Chemin absolu du vault ; null/undefined = défaut Documents/CyberScribeNote/vault */
  vaultPath?: string | null;
  /** Convertir auto les .txt du vault en .md puis supprimer le .txt source. */
  txtSyncEnabled?: boolean;
  /** Snapshots à chaque sauvegarde. */
  noteHistoryEnabled?: boolean;
  /** Max versions par note. */
  noteHistoryMax?: number;
}

export interface RecommendedModel {
  id: string;
  label: string;
  size: string;
  description: string;
}

export interface PullProgress {
  model: string;
  status: string;
  completed?: number;
  total?: number;
  percent?: number;
  done: boolean;
  error?: string;
}

export type ThemeMode = "light" | "dark";

export type AiAction = "summarize" | "reformulate" | "correct" | "translate" | "custom";

export type AiSuggestionSource = "manual" | "proactive";

export interface AiSuggestion {
  id: string;
  action: AiAction;
  label: string;
  scope: string;
  proposedText: string;
  originalText: string;
  /** Note à laquelle cette suggestion appartient — ignore si différente de la note active. */
  notePath?: string;
  source?: AiSuggestionSource;
  reason?: string;
  /** Mode d'application : append = complément ; tags = frontmatter tags. */
  applyMode?: "replace" | "append" | "tags";
  /** Skill de conception si la suggestion vient du catalogue, pas d'un prompt libre. */
  skillId?: string;
  selection?: { start: number; end: number; text: string };
}

export interface ProactiveSuggestionResponse {
  suggest: boolean;
  label?: string;
  proposed?: string;
  reason?: string;
}

export interface VoiceStatus {
  running: boolean;
  recording: boolean;
  transcribing: boolean;
  modelLoaded: boolean;
  modelLoading: boolean;
  depsOk: boolean;
  hotkey: string;
  error?: string;
}

export interface VoiceDepsStatus {
  /** `"sidecar"` = voice_worker.exe ; `"python"` = script + Python */
  mode?: "sidecar" | "python" | string;
  pythonFound: boolean;
  pythonPath: string;
  depsOk: boolean;
  workerPath: string;
  error?: string;
}

export interface VoiceTranscript {
  text: string;
}

export interface WhisperCacheEntry {
  name: string;
  path: string;
  sizeBytes: number;
  isDir: boolean;
}

export interface RagHit {
  path: string;
  title: string;
  text: string;
  score: number;
}

export interface RagStatus {
  indexed: boolean;
  model: string;
  chunkCount: number;
  noteCount: number;
  updatedAt?: string;
  indexPath: string;
}
