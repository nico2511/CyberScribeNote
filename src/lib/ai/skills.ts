import { hasMeaningfulDiff } from "$lib/ai/textDiff";
import {
  repairLocalMarkdown,
  upsertOutline,
  wrapWikilinks,
} from "$lib/markdown/structure";
import { buildTemplateMarkdown } from "$lib/ai/templates";
import { extractUrls, isLinkOnlyNote } from "$lib/ai/links";

export type SkillId =
  | "structure"
  | "outline"
  | "enrich"
  | "keypoints"
  | "tags"
  | "template"
  | "brief"
  | "plan"
  | "related"
  | "wikilinks";

export interface NoteSkill {
  id: SkillId;
  label: string;
  hint: string;
  /** true = Ollama. false = 100 % local, aucun risque d'hallucination. */
  needsLlm: boolean;
  applyMode: "replace" | "append" | "tags";
  /** Autorise une note vide (templates). */
  allowEmpty?: boolean;
  /** Enrichissement URL : fetch page avant LLM. */
  needsUrlFetch?: boolean;
  /** Injecte le RAG vault dans le prompt. */
  wantsRag?: boolean;
  voice: RegExp;
  promptMatch: RegExp;
  llmInstruction?: string;
  emptyMessage: string;
  /** Groupe UI optionnel. */
  group?: "shape" | "write" | "connect";
}

export const NOTE_SKILLS: NoteSkill[] = [
  {
    id: "structure",
    label: "Structurer",
    hint: "Répare le Markdown sans changer le fond",
    needsLlm: true,
    applyMode: "replace",
    group: "shape",
    voice: /^(structur\w*|format(?:e|er|age)?)\b/,
    promptMatch: /\b(structurer|formatage)\b/i,
    llmInstruction:
      "Tu reformates UNIQUEMENT la structure Markdown du texte fourni.\n" +
      "Règles STRICTES :\n" +
      "- Conserve TOUT le contenu, les mots, chemins, commandes et blocs de code tels quels\n" +
      "- Répare titres (#), listes, liens, fences ```\n" +
      "- N'invente pas de section, pas d'exemple, pas d'autre sujet\n" +
      "- Réponds uniquement avec le document Markdown complet",
    emptyMessage: "La structure Markdown est déjà propre.",
  },
  {
    id: "outline",
    label: "Sommaire",
    hint: "Table des matières depuis les titres",
    needsLlm: false,
    applyMode: "replace",
    group: "shape",
    voice: /^(sommaire|outline|table des matieres|table des mati\w*)\b/,
    promptMatch: /\b(sommaire|outline|table des mati[eè]res)\b/i,
    emptyMessage: "Pas assez de titres (H2+) pour un sommaire.",
  },
  {
    id: "enrich",
    label: "Lien",
    hint: "Enrichit une URL (titre, extrait) en brouillon de note",
    needsLlm: true,
    applyMode: "replace",
    needsUrlFetch: true,
    group: "write",
    voice: /^(enrich\w*|lien|url|page web)\b/,
    promptMatch: /\b(enrichir|analyser le lien|depuis l['']url)\b/i,
    llmInstruction:
      "À partir des MÉTADONNÉES et de l'extrait de contenu fournis (titre, description, URL, README/article si présent), rédige un brouillon de note Markdown.\n" +
      "Structure :\n# {titre}\n\nSource : {url}\n\n## Résumé\n(2–4 phrases d'après la description / extrait)\n\n## À retenir\n- …\n\n## Suite\n- [ ] …\n\n" +
      "N'invente PAS de faits absents des métadonnées ou de l'extrait. Si l'extrait est long, synthétise sans inventer.\n" +
      "Réponds uniquement avec le Markdown.",
    emptyMessage: "Aucun lien http(s) trouvé dans la note.",
  },
  {
    id: "keypoints",
    label: "Points clés",
    hint: "Idées essentielles + tâches déjà présentes",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    voice: /^(points?\s*cles?|keypoints?|essentiel|taches?|todos?|checklist)\b/,
    promptMatch: /\b(points? cl[eé]s?|extraire les actions|checklist)\b/i,
    llmInstruction:
      "Extrais de CETTE note uniquement :\n" +
      "1) ## Points clés — puces des idées déjà présentes (pas d'invention)\n" +
      "2) ## Tâches — checklist (- [ ]) des actions DÉJÀ mentionnées ; sinon écris (aucune tâche)\n" +
      "Réponds uniquement avec ces deux sections Markdown.",
    emptyMessage: "Pas assez de contenu pour des points clés.",
  },
  {
    id: "tags",
    label: "Tags",
    hint: "Propose des tags YAML pertinents",
    needsLlm: true,
    applyMode: "tags",
    group: "connect",
    voice: /^(tags?|etiquettes?|label)\b/,
    promptMatch: /\b(tags?|etiquettes?)\b/i,
    llmInstruction:
      "Propose 3 à 8 tags courts (minuscules, sans #) pour classer CETTE note.\n" +
      "Réponds EXACTEMENT dans ce format, rien d'autre :\n" +
      "tags: tag1, tag2, tag3\n" +
      "Uniquement d'après le contenu. Pas de phrase.",
    emptyMessage: "Impossible de proposer des tags.",
  },
  {
    id: "template",
    label: "Template",
    hint: "Daily, CR, fiche de lecture, journal projet",
    needsLlm: false,
    applyMode: "replace",
    allowEmpty: true,
    group: "shape",
    voice: /^(template|modele|daily|journal)\b/,
    promptMatch: /\b(template|mod[eè]le de note|daily note)\b/i,
    emptyMessage: "Template indisponible.",
  },
  {
    id: "brief",
    label: "Brief",
    hint: "Résumé ultra-court (2–3 phrases) en fin de note",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    voice: /^(brief|resume court|tl;?dr)\b/,
    promptMatch: /\b(brief|r[eé]sum[eé] court|tl;?dr)\b/i,
    llmInstruction:
      "Résume CETTE note en français en 2 ou 3 phrases max.\n" +
      "Pas de « Voici », pas de liste, pas de titre. Uniquement les phrases.\n" +
      "N'invente rien.",
    emptyMessage: "Pas assez de matière pour un brief.",
  },
  {
    id: "plan",
    label: "Plan",
    hint: "Architecture de note à ajouter en fin",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    voice: /^(plan|concevoir|conception|organise|organiser)\b/,
    promptMatch: /\b(plan de note|concevoir|conception)\b/i,
    llmInstruction:
      "Propose un PLAN DE CONCEPTION pour cette note.\n" +
      "- Sections H2/H3 recommandées (1 ligne chacune), uniquement d'après le texte\n" +
      "- Trous / questions manquantes\n" +
      "N'invente pas de faits. Réponds par ## Plan de note …",
    emptyMessage: "Pas assez de matière pour un plan.",
  },
  {
    id: "related",
    label: "Liées",
    hint: "Notes du vault sémantiquement proches (RAG)",
    needsLlm: false,
    applyMode: "append",
    wantsRag: true,
    group: "connect",
    voice: /^(liees?|related|notes? proches|similaires)\b/,
    promptMatch: /\b(notes? li[eé]es|notes? proches|similaires)\b/i,
    emptyMessage: "Aucune note liée trouvée (indexez le RAG dans Réglages).",
  },
  {
    id: "wikilinks",
    label: "[[Liens]]",
    hint: "Mentions → wikiliens vers le vault",
    needsLlm: false,
    applyMode: "replace",
    group: "connect",
    voice: /^(wikiliens?|wikilinks?)\b/,
    promptMatch: /\b(wikilinks?|wikiliens?|liens internes)\b/i,
    emptyMessage: "Aucune mention d'une autre note à lier.",
  },
];

export function getSkill(id: SkillId): NoteSkill {
  const skill = NOTE_SKILLS.find((s) => s.id === id);
  if (!skill) throw new Error(`Skill inconnue : ${id}`);
  return skill;
}

/**
 * Match voix / commande courte uniquement.
 * Une consigne libre longue ne doit JAMAIS être détournée vers une skill.
 */
export function matchSkillFromText(text: string): SkillId | null {
  const t = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.,;:!?…]+$/g, "")
    .trim();
  if (!t) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 4) return null;
  for (const skill of NOTE_SKILLS) {
    if (skill.voice.test(t)) return skill.id;
  }
  return null;
}

export interface SkillLocalContext {
  titles?: string[];
  currentTitle?: string;
  noteContext?: string;
  /** Bloc RAG déjà formaté pour skill related. */
  ragBlock?: string;
}

export interface SkillLocalResult {
  proposed: string;
  reason: string;
  applyMode?: NoteSkill["applyMode"];
}

/** Exécute la partie déterministe d'une skill (0 hallucination). */
export function runSkillLocal(
  id: SkillId,
  markdown: string,
  ctx: SkillLocalContext = {},
): SkillLocalResult | null {
  if (id === "outline") {
    const proposed = upsertOutline(markdown);
    if (!proposed || !hasMeaningfulDiff(markdown, proposed)) return null;
    return { proposed, reason: "Sommaire généré depuis les titres de la note." };
  }
  if (id === "structure") {
    const proposed = repairLocalMarkdown(markdown);
    if (!hasMeaningfulDiff(markdown, proposed)) return null;
    return {
      proposed,
      reason: "Réparation locale (titres, fences, YAML/Docker).",
    };
  }
  if (id === "wikilinks") {
    const proposed = wrapWikilinks(markdown, ctx.titles ?? [], ctx.currentTitle);
    if (!proposed || !hasMeaningfulDiff(markdown, proposed)) return null;
    return { proposed, reason: "Mentions du vault transformées en [[wikiliens]]." };
  }
  if (id === "template") {
    const { proposed, reason } = buildTemplateMarkdown(markdown, ctx.noteContext);
    const mode: NoteSkill["applyMode"] = markdown.trim() ? "append" : "replace";
    return { proposed, reason, applyMode: mode };
  }
  if (id === "related") {
    const rag = (ctx.ragBlock ?? "").trim();
    if (!rag) return null;
    return {
      proposed: `\n\n---\n\n## Notes liées\n\n${rag}\n`,
      reason: "Extraits proches dans le vault (RAG).",
      applyMode: "append",
    };
  }
  return null;
}

export function isEmptyLlmAppendix(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    !t ||
    /\(aucune t[aâ]che\)/.test(t) ||
    /aucune t[aâ]che explicite/.test(t) ||
    /^n[/'']?a rien a (ajouter|proposer)/.test(t)
  );
}

/** Parse `tags: a, b, c` depuis une réponse LLM. */
export function parseTagsProposal(text: string): string[] {
  const m = text.match(/tags\s*:\s*([^\n]+)/i);
  if (!m?.[1]) return [];
  return m[1]
    .split(/[,;]/)
    .map((t) => t.trim().replace(/^#/, "").toLowerCase())
    .filter((t) => t.length >= 2 && t.length <= 32)
    .slice(0, 10);
}

export function formatEnrichContext(meta: {
  url: string;
  title: string;
  description: string;
  siteName?: string | null;
  excerpt?: string | null;
}): string {
  const parts = [
    `URL: ${meta.url}`,
    `Titre: ${meta.title || "(inconnu)"}`,
    meta.siteName ? `Site: ${meta.siteName}` : null,
    `Description: ${meta.description || "(vide)"}`,
  ];
  const excerpt = meta.excerpt?.trim();
  if (excerpt) {
    parts.push(`Contenu / README (extrait) :\n${excerpt}`);
  }
  return parts.filter(Boolean).join("\n");
}

export { extractUrls, isLinkOnlyNote };
