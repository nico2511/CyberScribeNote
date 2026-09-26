import { extractUrls } from "$lib/ai/links";
import {
  getSkill,
  matchSkillFromText,
  NOTE_SKILLS,
  type SkillId,
  type SkillTheme,
} from "$lib/ai/skills";

export type { SkillTheme };

/** Une étape du plan, avec le thème et la raison locale. */
export interface RoutedSkill {
  id: SkillId;
  theme: SkillTheme;
  confidence: number;
  why: string;
}

/**
 * Plan ordonné. `skills` est l'ordre d'exécution (1 à N).
 * `source` : `rules` hors-ligne, `llm` si le crochet optionnel a primé.
 */
export interface SkillRoutePlan {
  skills: SkillId[];
  themes: SkillTheme[];
  confidence: number;
  why: string;
  source: "rules" | "llm";
  steps: RoutedSkill[];
}

export interface SkillRouteInput {
  /** Consigne libre, transcript, ou chaîne vide si seuls les drapeaux comptent. */
  text: string;
  /** Extrait markdown optionnel. N'ajoute un plan que si le texte est vague. */
  noteExcerpt?: string;
  hasSelection?: boolean;
  hasUrl?: boolean;
  hasRelated?: boolean;
  docImported?: boolean;
}

export interface SkillRouteHooks {
  /**
   * Classifieur optionnel (Ollama plus tard). Synchrone : les tests n'ont pas
   * besoin d'un modèle. `null`, exception, ou confiance plus basse → règles.
   */
  classify?: (input: SkillRouteInput) => SkillRoutePlan | null;
}

/** Ordre de travail : préparer, extraire, rédiger, classer, relier. */
const PIPELINE_ORDER: SkillId[] = [
  "folderIndex",
  "template",
  "structure",
  "proofread",
  "enrich",
  "sources",
  "plan",
  "outline",
  "title",
  "keypoints",
  "decisions",
  "actions",
  "questions",
  "brief",
  "clarify",
  "shorten",
  "tags",
  "related",
  "wikilinks",
];

const MAX_SKILLS = 4;
const MIN_SCORE = 0.6;

const KNOWN_IDS = new Set<SkillId>(NOTE_SKILLS.map((s) => s.id));

interface Bundle {
  re: RegExp;
  skills: { id: SkillId; score: number }[];
  why: string;
}

const BUNDLES: Bundle[] = [
  {
    re: /\b(analys\w*|debrief\w*|decrypt\w*|comprendre)\b/,
    skills: [
      { id: "keypoints", score: 0.86 },
      { id: "brief", score: 0.82 },
      { id: "tags", score: 0.74 },
    ],
    why: "Analyse : points clés, brief, puis tags.",
  },
  {
    re: /\b(constru\w*|architect\w*|organis\w*)\b/,
    skills: [
      { id: "plan", score: 0.84 },
      { id: "outline", score: 0.72 },
    ],
    why: "Construction : plan de note, puis sommaire.",
  },
  {
    re: /\b(amelior\w*|repare\w*|reparer|mets en forme|mise en forme|formatage|balises markdown)\b/,
    skills: [{ id: "structure", score: 0.84 }],
    why: "Amélioration : réparer la structure Markdown.",
  },
  {
    re: /\b(prise de notes|prends des notes|journal de bord|daily note)\b/,
    skills: [
      { id: "template", score: 0.86 },
      { id: "keypoints", score: 0.64 },
    ],
    why: "Prise de notes : template, puis points clés.",
  },
  {
    re: /\b(redige\w*|redaction|ecris|ecrire|ecrivez)\b/,
    skills: [
      { id: "plan", score: 0.7 },
      { id: "brief", score: 0.74 },
    ],
    why: "Écriture : plan, puis brief.",
  },
  {
    re: /\b(relie[rz]?|relier|connecter|connexion)\b/,
    skills: [
      { id: "related", score: 0.82 },
      { id: "wikilinks", score: 0.74 },
    ],
    why: "Connexion : notes liées, puis wikiliens.",
  },
];

const EXPLICIT: { id: SkillId; re: RegExp; why: string }[] = [
  {
    id: "structure",
    re: /\b(structur\w*|formatage|balises markdown)\b/,
    why: "Structurer demandé.",
  },
  {
    id: "outline",
    re: /\b(sommaire|table des matieres|outline)\b/,
    why: "Sommaire demandé.",
  },
  {
    id: "folderIndex",
    re: /\b(indexe[rz]?|indexer)\b(?:\s+\w+){0,3}\s+\bdossier\b|\bdossier\b(?:\s+\w+){0,3}\s+\b(indexe[rz]?|indexer)\b/,
    why: "Indexer le dossier demandé.",
  },
  {
    id: "enrich",
    re: /\b(enrich\w*|analyser le lien|depuis l'url|page web)\b/,
    why: "Lien demandé.",
  },
  {
    id: "keypoints",
    re: /\b(points?\s+cles?|keypoints?|checklist)\b/,
    why: "Points clés demandés.",
  },
  {
    id: "tags",
    re: /\b(tags?|etiquettes?)\b/,
    why: "Tags demandés.",
  },
  {
    id: "template",
    re: /\b(template|modele de note|daily)\b/,
    why: "Template demandé.",
  },
  {
    id: "brief",
    re: /\b(brief|resume court|tldr|tl;dr|synthese)\b/,
    why: "Brief demandé.",
  },
  {
    id: "plan",
    re: /\b(plan(?:\s+de\s+note)?|concevoir|conception)\b/,
    why: "Plan demandé.",
  },
  {
    id: "related",
    re: /\b(notes? liees|notes? proches|similaires)\b/,
    why: "Notes liées demandées.",
  },
  {
    id: "wikilinks",
    re: /\b(wikilinks?|wikiliens?|liens internes)\b/,
    why: "Wikiliens demandés.",
  },
  {
    id: "actions",
    re: /\b(actions?|taches?|todos?|quelles sont les actions)\b/,
    why: "Actions demandées.",
  },
  {
    id: "questions",
    re: /\b(questions?|a creuser|ouvertures?)\b/,
    why: "Questions demandées.",
  },
  {
    id: "decisions",
    re: /\b(decisions?|arbitrages?|on a decide)\b/,
    why: "Décisions demandées.",
  },
  {
    id: "clarify",
    re: /\b(clarifi\w*|eclaircis\w*|reformule plus clair)\b/,
    why: "Clarifier demandé.",
  },
  {
    id: "shorten",
    re: /\b(raccourc\w*|condense\w*|plus court)\b/,
    why: "Raccourcir demandé.",
  },
  {
    id: "title",
    re: /\b(titre|intitule|renomme (cette|la) note)\b/,
    why: "Titre demandé.",
  },
  {
    id: "proofread",
    re: /\b(relis\w*|orthographe|typos?|relecture|corrige\w*)\b/,
    why: "Relire demandé.",
  },
  {
    id: "sources",
    re: /\b(sources?|references?|bibliographie)\b/,
    why: "Sources demandées.",
  },
];

const CR_RE = /\b(compte[\s-]*rendu|\bcr\b)\b/;
const ANALYSE_RE = BUNDLES[0].re;

/** Verbe en tête de phrase (après politesse) : la voix peut quitter le match court. */
const INTENT_START_RE =
  /^(?:analys\w*|structur\w*|sommaire|brief|tags?|etiquettes?|plan|template|modele|enrich\w*|indexe\w*|indexer|relie\w*|constru\w*|amelior\w*|redige\w*|ecri\w*|points?|wikiliens?|wikilinks?|organis\w*|fais|fait|faire|ajoute|proposer|propose|mets|actions?|questions?|decisions?|arbitrages?|clarifi\w*|eclaircis\w*|raccourc\w*|condense\w*|titre|intitule|renomme|relis\w*|orthographe|typos?|corrige\w*|sources?|references?|bibliographie)\b/;

export function normalizeIntentText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Vrai si la consigne commence par un verbe de skill (commande, pas une dictée). */
export function opensSkillIntent(text: string): boolean {
  const n = normalizeIntentText(text).replace(
    /^(?:peux tu|tu peux|merci de|s'il te plait|s il te plait|stp)\s+/,
    "",
  );
  return INTENT_START_RE.test(n);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pipelineIndex(id: SkillId): number {
  const i = PIPELINE_ORDER.indexOf(id);
  return i === -1 ? PIPELINE_ORDER.length : i;
}

function themesOf(ids: SkillId[]): SkillTheme[] {
  const out: SkillTheme[] = [];
  for (const id of ids) {
    const theme = getSkill(id).theme;
    if (!out.includes(theme)) out.push(theme);
  }
  return out;
}

function stepsFor(ids: SkillId[], scores: Map<SkillId, number>, whys: Map<SkillId, string>): RoutedSkill[] {
  return ids.map((id) => ({
    id,
    theme: getSkill(id).theme,
    confidence: round2(scores.get(id) ?? 0.7),
    why: whys.get(id) ?? getSkill(id).hint,
  }));
}

function planFromScores(
  scores: Map<SkillId, number>,
  whys: Map<SkillId, string>,
  reasons: string[],
  confidenceNudge = 0,
): SkillRoutePlan | null {
  const ranked = [...scores.entries()]
    .filter(([, score]) => score >= MIN_SCORE)
    .sort((a, b) => b[1] - a[1] || pipelineIndex(a[0]) - pipelineIndex(b[0]));
  const picked = ranked.slice(0, MAX_SKILLS).map(([id]) => id);
  if (!picked.length) return null;
  picked.sort((a, b) => pipelineIndex(a) - pipelineIndex(b));

  const avg = picked.reduce((sum, id) => sum + (scores.get(id) ?? 0), 0) / picked.length;
  const confidence = round2(clamp01(avg + confidenceNudge));
  const why = reasons.filter(Boolean).join(" ").trim() || picked.map((id) => whys.get(id) ?? "").filter(Boolean).join(" ");

  return {
    skills: picked,
    themes: themesOf(picked),
    confidence,
    why,
    source: "rules",
    steps: stepsFor(picked, scores, whys),
  };
}

function bump(
  scores: Map<SkillId, number>,
  whys: Map<SkillId, string>,
  id: SkillId,
  score: number,
  why: string,
): void {
  const prev = scores.get(id) ?? 0;
  if (score >= prev) {
    scores.set(id, score);
    if (score > prev || !whys.has(id)) whys.set(id, why);
  }
}

function excerptLooksUnfinished(excerpt: string | undefined): boolean {
  const body = (excerpt ?? "").trim();
  if (body.length < 500) return false;
  if (/tags:\s*\[/i.test(body)) return false;
  if (/^##\s+(Brief|R[eé]sum[eé]|TL;?DR)\b/im.test(body)) return false;
  if (/^##\s+Points cl[eé]s\b/im.test(body)) return false;
  return true;
}

function routeByRules(input: SkillRouteInput): SkillRoutePlan | null {
  const norm = normalizeIntentText(input.text);
  const scores = new Map<SkillId, number>();
  const whys = new Map<SkillId, string>();
  const reasons: string[] = [];

  const direct = norm ? matchSkillFromText(input.text) : null;
  if (direct) {
    const why = `Commande courte : ${getSkill(direct).label}.`;
    bump(scores, whys, direct, 0.93, why);
    return planFromScores(scores, whys, [why]);
  }

  const vague = !norm || /^(cette note|la note|ce texte|note)$/.test(norm);

  if (!vague) {
    for (const bundle of BUNDLES) {
      if (!bundle.re.test(norm)) continue;
      reasons.push(bundle.why);
      for (const step of bundle.skills) bump(scores, whys, step.id, step.score, bundle.why);
    }

    if (CR_RE.test(norm) && !ANALYSE_RE.test(norm)) {
      const why = "Compte rendu : points clés, brief, puis tags.";
      reasons.push(why);
      bump(scores, whys, "keypoints", 0.8, why);
      bump(scores, whys, "brief", 0.76, why);
      bump(scores, whys, "tags", 0.7, why);
    }

    for (const hit of EXPLICIT) {
      if (!hit.re.test(norm)) continue;
      bump(scores, whys, hit.id, 0.9, hit.why);
      if (!reasons.some((r) => r.includes(hit.why))) reasons.push(hit.why);
    }
  } else if (excerptLooksUnfinished(input.noteExcerpt)) {
    const why = "Note longue sans brief ni tags.";
    reasons.push(why);
    bump(scores, whys, "keypoints", 0.78, why);
    bump(scores, whys, "brief", 0.74, why);
    bump(scores, whys, "tags", 0.68, why);
  }

  if (input.hasUrl) {
    const why = "Un lien est présent.";
    reasons.push(why);
    bump(scores, whys, "enrich", 0.8, why);
  }

  if (input.docImported) {
    const why = "Document importé : structurer, extraire, taguer.";
    reasons.push(why);
    bump(scores, whys, "structure", 0.8, why);
    bump(scores, whys, "keypoints", 0.76, why);
    bump(scores, whys, "tags", 0.7, why);
    const blob = `${input.noteExcerpt ?? ""}\n${input.text}`;
    if (input.hasUrl || extractUrls(blob).length > 0) {
      const srcWhy = "Des URL sont déjà dans le document.";
      reasons.push(srcWhy);
      bump(scores, whys, "sources", 0.73, srcWhy);
    }
  }

  const mentionsVault = /\b(vault|rapproch\w*|liee\w*|lier)\b/.test(norm);
  if (input.hasRelated && (scores.size === 0 || mentionsVault)) {
    const why = "Des notes du vault semblent proches.";
    reasons.push(why);
    bump(scores, whys, "related", 0.66, why);
  }

  const nudge = input.hasSelection ? 0.02 : 0;
  const plan = planFromScores(scores, whys, reasons, nudge);
  if (plan && input.hasSelection && !plan.why.includes("Sélection")) {
    plan.why = `${plan.why} Sélection prise en compte.`.trim();
  }
  return plan;
}

function acceptLlmPlan(raw: SkillRoutePlan | null): SkillRoutePlan | null {
  if (!raw) return null;
  const skills: SkillId[] = [];
  for (const id of raw.skills ?? []) {
    if (KNOWN_IDS.has(id) && !skills.includes(id)) skills.push(id);
  }
  if (!skills.length) return null;
  const confidence = round2(clamp01(raw.confidence));
  const why = (raw.why ?? "").trim() || "Classement du modèle local.";
  const scores = new Map<SkillId, number>(skills.map((id) => [id, confidence]));
  const whys = new Map<SkillId, string>(skills.map((id) => [id, why]));
  return {
    skills,
    themes: themesOf(skills),
    confidence,
    why,
    source: "llm",
    steps: raw.steps?.length
      ? raw.steps.filter((s) => skills.includes(s.id))
      : stepsFor(skills, scores, whys),
  };
}

/**
 * Choisit 1 à N skills. Les règles marchent sans Ollama.
 * Le crochet `classify` ne remplace les règles que s'il est plus sûr.
 */
export function routeSkillsFromIntent(
  input: SkillRouteInput,
  hooks?: SkillRouteHooks,
): SkillRoutePlan | null {
  const rules = routeByRules(input);
  if (!hooks?.classify) return rules;

  let llm: SkillRoutePlan | null = null;
  try {
    llm = acceptLlmPlan(hooks.classify(input));
  } catch {
    llm = null;
  }
  if (!llm) return rules;
  if (!rules) return llm;
  if (llm.confidence > rules.confidence) return llm;
  return rules;
}

/** Phrase UI : « Je lance Brief puis Tags. » */
export function combineSkillPlan(plan: Pick<SkillRoutePlan, "skills">): string {
  const labels = plan.skills.map((id) => getSkill(id).label);
  if (labels.length === 0) return "Aucun skill à lancer.";
  if (labels.length === 1) return `Je lance ${labels[0]}.`;
  const last = labels[labels.length - 1];
  const head = labels.slice(0, -1);
  if (head.length === 1) return `Je lance ${head[0]} puis ${last}.`;
  return `Je lance ${head.join(", ")} puis ${last}.`;
}
