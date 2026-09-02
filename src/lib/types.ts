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

export type AiAction = "summarize" | "reformulate" | "correct" | "translate_en";

export interface AiSuggestion {
  id: string;
  action: AiAction;
  label: string;
  scope: string;
  proposedText: string;
  originalText: string;
  selection?: { start: number; end: number; text: string };
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
