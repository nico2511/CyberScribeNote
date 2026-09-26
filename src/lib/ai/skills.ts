import { extractUrls, isLinkOnlyNote } from "$lib/ai/links";
import { noteBody, noteBodyRange, parseFrontmatterMeta } from "$lib/note/frontmatter";

export type SkillId =
  | "structure"
  | "outline"
  | "folderIndex"
  | "enrich"
  | "keypoints"
  | "tags"
  | "template"
  | "brief"
  | "plan"
  | "related"
  | "wikilinks"
  | "actions"
  | "questions"
  | "decisions"
  | "clarify"
  | "shorten"
  | "title"
  | "proofread"
  | "sources";

/** Thème du cerveau. Le menu IA garde `group` (shape | write | connect). */
export type SkillTheme =
  | "prise-de-notes"
  | "analyse"
  | "ecriture"
  | "construction"
  | "amelioration"
  | "documents"
  | "connexion";

export interface NoteSkill {
  id: SkillId;
  label: string;
  hint: string;
  /** Toute skill du catalogue rédige via Ollama. Pas de résultat « local » présenté comme l'IA. */
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
  /** Groupe UI optionnel (menu IA ▾). */
  group?: "shape" | "write" | "connect";
  /** Thème du routeur. Indépendant du groupe d'affichage. */
  theme: SkillTheme;
}

export const NOTE_SKILLS: NoteSkill[] = [
  {
    id: "structure",
    label: "Structurer",
    hint: "Répare le Markdown sans changer le fond",
    needsLlm: true,
    applyMode: "replace",
    group: "shape",
    theme: "amelioration",
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
    needsLlm: true,
    applyMode: "replace",
    group: "shape",
    theme: "construction",
    voice: /^(sommaire|outline|table des matieres|table des mati\w*)\b/,
    promptMatch: /\b(sommaire|outline|table des mati[eè]res)\b/i,
    llmInstruction:
      "Construis ou mets à jour la section ## Sommaire UNIQUEMENT à partir des titres H2 et plus déjà présents.\n" +
      "N'invente aucun titre ni section.\n" +
      "Conserve tout le reste du document (mots, code, liens).\n" +
      "Réponds uniquement avec le document Markdown complet.",
    emptyMessage: "Pas assez de titres (H2+) pour un sommaire.",
  },
  {
    id: "folderIndex",
    label: "Indexer dossier",
    hint: "Rédige sommaire.md du dossier à partir de l'inventaire local",
    needsLlm: true,
    applyMode: "replace",
    allowEmpty: true,
    group: "connect",
    theme: "documents",
    voice: /^(indexer?|indexe)(\s+(ce\s+)?dossier)?\b/,
    promptMatch: /\b(indexer|indexe)\s+(ce\s+)?dossier\b/i,
    llmInstruction:
      "Rédige le fichier sommaire.md de ce dossier en français, à partir de l'inventaire fourni.\n" +
      "Inclus chaque note et chaque sous-dossier listés, comme wikilien [[chemin]].\n" +
      "N'ajoute aucune note, aucun fait, aucune URL absents de l'inventaire.\n" +
      "Réponds uniquement avec le Markdown du sommaire.",
    emptyMessage: "Ce dossier ne contient aucune note à indexer.",
  },
  {
    id: "enrich",
    label: "Lien",
    hint: "Enrichit une URL — ajoute une section en fin de note (n'écrase pas)",
    needsLlm: true,
    applyMode: "append",
    needsUrlFetch: true,
    group: "write",
    theme: "documents",
    voice: /^(enrich\w*|lien|url|page web)\b/,
    promptMatch: /\b(enrichir|analyser le lien|depuis l['']url)\b/i,
    llmInstruction:
      "À partir des MÉTADONNÉES et de l'extrait fournis (titre, description, URL, README/article si présent), rédige une SECTION Markdown à AJOUTER en fin de note.\n" +
      "Structure :\n## Lien · {titre}\n\nSource : {url}\n\n### Résumé\n(2–4 phrases d'après la description / extrait)\n\n### À retenir\n- …\n\n### Suite\n- [ ] …\n\n" +
      "N'invente PAS de faits absents des métadonnées ou de l'extrait. Pas de frontmatter, pas de document complet.\n" +
      "Réponds uniquement avec le Markdown de la section.",
    emptyMessage: "Aucun lien http(s) trouvé dans la note.",
  },
  {
    id: "keypoints",
    label: "Points clés",
    hint: "Idées essentielles + tâches déjà présentes",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "analyse",
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
    theme: "connexion",
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
    needsLlm: true,
    applyMode: "replace",
    allowEmpty: true,
    group: "shape",
    theme: "prise-de-notes",
    voice: /^(template|modele|daily|journal)\b/,
    promptMatch: /\b(template|mod[eè]le de note|daily note)\b/i,
    llmInstruction:
      "Propose un modèle de note en français : daily, compte-rendu, fiche de lecture ou journal de projet, selon le contexte.\n" +
      "Si la note est vide, réponds avec le document Markdown complet (titres et sections à remplir).\n" +
      "Si la note a déjà du contenu, réponds uniquement par un bloc ## Template à ajouter, sans réécrire le texte existant.\n" +
      "N'invente pas de noms, décisions ou faits absents du contexte.",
    emptyMessage: "Template indisponible.",
  },
  {
    id: "brief",
    label: "Brief",
    hint: "Résumé ultra-court (2–3 phrases) en fin de note",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "ecriture",
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
    theme: "construction",
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
    hint: "Notes du vault sémantiquement proches (RAG), rédigées par Ollama",
    needsLlm: true,
    applyMode: "append",
    wantsRag: true,
    group: "connect",
    theme: "connexion",
    voice: /^(liees?|related|notes? proches|similaires)\b/,
    promptMatch: /\b(notes? li[eé]es|notes? proches|similaires)\b/i,
    llmInstruction:
      "À partir UNIQUEMENT du contexte RAG fourni, rédige :\n" +
      "## Notes liées\n" +
      "- [[titre]] — court extrait déjà présent dans le contexte\n" +
      "Si rien n'est pertinent, réponds exactement :\n" +
      "## Notes liées\n\nAucune note liée pertinente dans le vault.\n" +
      "N'invente aucune note ni extrait.",
    emptyMessage: "Aucune note liée trouvée (indexez le RAG dans Réglages).",
  },
  {
    id: "wikilinks",
    label: "[[Liens]]",
    hint: "Mentions → wikiliens vers le vault",
    needsLlm: true,
    applyMode: "replace",
    group: "connect",
    theme: "connexion",
    voice: /^(wikiliens?|wikilinks?)\b/,
    promptMatch: /\b(wikilinks?|wikiliens?|liens internes)\b/i,
    llmInstruction:
      "Transforme en [[wikiliens]] UNIQUEMENT les mentions des titres de vault fournis.\n" +
      "N'invente pas de note. Ne change pas le fond.\n" +
      "Réponds uniquement avec le document Markdown complet.",
    emptyMessage: "Aucune autre note du vault à lier.",
  },
  {
    id: "actions",
    label: "Actions",
    hint: "Checklist des tâches déjà mentionnées",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "analyse",
    voice: /^(actions?)\b/,
    promptMatch: /\b(actions?|quelles sont les actions)\b/i,
    llmInstruction:
      "Extrais UNIQUEMENT les tâches et prochaines étapes DÉJÀ écrites dans CETTE note.\n" +
      "Réponds par une section :\n## Actions\n- [ ] …\n" +
      "S'il n'y a aucune action explicite, réponds exactement :\n## Actions\n\n(aucune action déjà mentionnée)\n" +
      "N'invente rien. Pas d'idées générales, pas de résumé, pas de « Voici ».",
    emptyMessage: "Aucune action déjà mentionnée dans la note.",
  },
  {
    id: "questions",
    label: "Questions",
    hint: "Questions ouvertes et trous déjà visibles",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "analyse",
    voice: /^(questions?|a creuser|ouvertures?)\b/,
    promptMatch: /\b(questions?|à creuser|ouvertures?)\b/i,
    llmInstruction:
      "Liste UNIQUEMENT les questions ouvertes et les trous DÉJÀ visibles dans CETTE note.\n" +
      "Réponds par :\n## Questions\n- …\n" +
      "S'il n'y en a pas, réponds exactement :\n## Questions\n\n(aucune question déjà ouverte)\n" +
      "Pas de quiz inventé. Pas de « Voici ».",
    emptyMessage: "Aucune question déjà ouverte dans la note.",
  },
  {
    id: "decisions",
    label: "Décisions",
    hint: "Décisions déjà posées — sinon le dire",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "analyse",
    voice: /^(decisions?|arbitrages?)\b/,
    promptMatch: /\b(d[eé]cisions?|arbitrages?|on a d[eé]cid[eé])\b/i,
    llmInstruction:
      "Extrais UNIQUEMENT les décisions DÉJÀ posées dans CETTE note (CR, réunion, arbitrage).\n" +
      "Réponds par :\n## Décisions\n- …\n" +
      "S'il n'y en a aucune, réponds exactement :\n## Décisions\n\nAucune décision déjà posée dans cette note.\n" +
      "N'en fabrique pas. Pas de « Voici ».",
    emptyMessage: "Aucune décision déjà posée dans la note.",
  },
  {
    id: "clarify",
    label: "Clarifier",
    hint: "Même faits, français plus clair — section en fin de note",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "ecriture",
    voice: /^(clarifie\w*|eclaircis\w*)\b/,
    promptMatch: /\b(clarifi\w*|éclaircis\w*|reformule plus clair)\b/i,
    llmInstruction:
      "Réécris CETTE note (ou la sélection) en français plus clair.\n" +
      "MÊMES faits, mêmes noms, mêmes chiffres. N'ajoute rien.\n" +
      "Pas de « Voici ». Pas de préambule.\n" +
      "Réponds uniquement avec le texte clarifié.",
    emptyMessage: "Pas assez de matière à clarifier.",
  },
  {
    id: "shorten",
    label: "Raccourcir",
    hint: "Version plus courte, mêmes faits",
    needsLlm: true,
    applyMode: "append",
    group: "write",
    theme: "ecriture",
    voice: /^(raccourcis\w*|condense\w*)\b/,
    promptMatch: /\b(raccourc\w*|condens\w*|plus court)\b/i,
    llmInstruction:
      "Produis une version PLUS COURTE de CETTE note.\n" +
      "Mêmes faits, mêmes noms, mêmes chiffres. Coupe les répétitions, n'invente rien.\n" +
      "Pas de « Voici ». Pas de titre « Résumé ». Uniquement le texte court.",
    emptyMessage: "Pas assez de matière à raccourcir.",
  },
  {
    id: "title",
    label: "Titre",
    hint: "Titre d'après le contenu, sans changer un titre déjà bon",
    needsLlm: true,
    applyMode: "replace",
    group: "shape",
    theme: "construction",
    voice: /^(titre|intitule|renomme cette note|renomme la note)\b/,
    promptMatch: /\b(titre|intitul[eé]|renomme cette note)\b/i,
    llmInstruction:
      "Propose UN titre court (8 à 60 caractères) qui décrit CETTE note.\n" +
      "Uniquement des mots déjà suggérés par le contenu. N'invente pas de sujet.\n" +
      "Réponds EXACTEMENT, rien d'autre :\ntitre: …",
    emptyMessage: "Le titre est déjà en place.",
  },
  {
    id: "proofread",
    label: "Relire",
    hint: "Orthographe et ponctuation, sans changer le fond",
    needsLlm: true,
    applyMode: "replace",
    group: "shape",
    theme: "amelioration",
    voice: /^(relis\w*|orthographe|typos?|corrige\w*)\b/,
    promptMatch: /\b(relis\w*|orthographe|typos?|relecture)\b/i,
    llmInstruction:
      "Corrige UNIQUEMENT l'orthographe, la typographie et la ponctuation de CETTE note.\n" +
      "Ne change pas le fond, l'ordre, les titres ni les faits.\n" +
      "Réponds avec le document complet corrigé. Pas de commentaire.",
    emptyMessage: "Rien à relire — le texte est déjà propre.",
  },
  {
    id: "sources",
    label: "Sources",
    hint: "Section Sources rédigée par Ollama, uniquement les URL déjà écrites",
    needsLlm: true,
    applyMode: "append",
    group: "connect",
    theme: "documents",
    voice: /^(sources?|references?|bibliographie)\b/,
    promptMatch: /\b(sources?|r[eé]f[eé]rences?|bibliographie)\b/i,
    llmInstruction:
      "Rédige une section ## Sources qui liste UNIQUEMENT les URL déjà fournies.\n" +
      "Pas de fetch, pas de nouvelle URL, pas de résumé inventé.\n" +
      "Format :\n## Sources\n- [libellé court déjà dans la note, sinon le domaine](url)\n" +
      "Réponds uniquement avec cette section.",
    emptyMessage: "Aucune URL à lister, ou la section Sources est déjà là.",
  },
];

export function getSkill(id: SkillId): NoteSkill {
  const skill = NOTE_SKILLS.find((s) => s.id === id);
  if (!skill) throw new Error(`Skill inconnue : ${id}`);
  return skill;
}

/**
 * Match voix / commande courte uniquement (≤ 4 mots).
 * Une consigne libre plus longue reste ignorée ici : elle passe par
 * `routeSkillsFromIntent` (`skillRouter`), qui peut enchaîner plusieurs skills.
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

/** Cibles `[[…]]` (sans ancre ni alias). */
export function wikilinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Les wikiliens nouveaux doivent être des titres du vault (ou déjà présents dans la note).
 */
export function proposedWikilinksStayInVault(
  original: string,
  proposed: string,
  titles: string[],
): boolean {
  const allowed = new Set(
    [...titles, ...wikilinkTargets(original)].map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  return wikilinkTargets(proposed).every((t) => allowed.has(t.toLowerCase()));
}

export function hasMarkdownSection(markdown: string, title: string): boolean {
  const wanted = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return markdown.split("\n").some((line) => {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m) return false;
    const got = m[1]
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    return got === wanted || got.startsWith(`${wanted} `);
  });
}

const WEAK_TITLES = new Set([
  "note",
  "notes",
  "sans titre",
  "untitled",
  "titre",
  "todo",
  "brouillon",
  "nouveau",
  "nouvelle note",
  "document",
]);

function isSolidTitleText(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 8) return false;
  const n = t
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return !WEAK_TITLES.has(n);
}

/** Titre H1 ou YAML déjà assez précis pour ne pas le remplacer. */
export function titleIsSolid(content: string): boolean {
  const h1 = noteBody(content).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const fm = parseFrontmatterMeta(content).title.trim();
  return isSolidTitleText(h1) || isSolidTitleText(fm);
}

export function parseTitleProposal(text: string): string | null {
  const line = (text.match(/titre\s*:\s*(.+)/i)?.[1] ?? text.split("\n")[0] ?? "")
    .replace(/^#+\s*/, "")
    .trim();
  if (line.length < 3 || line.length > 80) return null;
  if (/^(voici|titre)\b/i.test(line)) return null;
  return line;
}

/** Le titre proposé reprend au moins un mot significatif de la note. */
export function titleStaysOnTopic(note: string, title: string): boolean {
  const titleTokens = significantEnough(title);
  if (!titleTokens.length) return false;
  const noteSet = new Set(significantEnough(note));
  return titleTokens.some((t) => noteSet.has(t));
}

function significantEnough(text: string): string[] {
  return (text.match(/[\p{L}\p{N}]{4,}/gu) ?? [])
    .map((w) => w.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""))
    .filter((w) => w.length >= 4);
}

/** Pose le titre en H1 et, s'il y a un frontmatter, dans `title:`. */
export function withProposedTitle(content: string, title: string): string {
  const safe = title.replace(/[\r\n#"]/g, " ").replace(/\s+/g, " ").trim();
  if (!safe) return content;
  const next = upsertFrontmatterTitle(content, safe);
  const range = noteBodyRange(next);
  const body = next.slice(range.start);
  const newBody = /^#\s+\S/m.test(body)
    ? body.replace(/^#\s+.*$/m, `# ${safe}`)
    : `# ${safe}\n\n${body.replace(/^\n+/, "")}`;
  return next.slice(0, range.start) + newBody;
}

function upsertFrontmatterTitle(content: string, title: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  if (end === -1) return content;
  const fm = content.slice(3, end);
  const rest = content.slice(end + 3);
  const lines = fm.split("\n").filter((l) => !l.trim().startsWith("title:"));
  const core = lines.filter((l, i) => !(i === 0 && l.trim() === ""));
  core.unshift(`title: "${title}"`);
  const body = rest.startsWith("\n") ? rest : `\n${rest}`;
  return `---\n${core.join("\n").replace(/^\n+|\n+$/g, "")}\n---${body}`;
}

/** Sélection courte : Clarifier remplace le passage. Au-delà, section en fin de note. */
export const CLARIFY_SELECTION_MAX = 800;

export function wrapNamedSection(heading: string, body: string): string {
  let trimmed = body.trim();
  trimmed = trimmed.replace(
    /^(?:voici|voila|voilà)\s+(?:la\s+)?(?:version\s+)?(?:claire|courte)?\s*[:.]?\s*/i,
    "",
  );
  if (/^##\s+/m.test(trimmed)) return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  return `## ${heading}\n\n${trimmed}\n`;
}

export function isEmptyLlmAppendix(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    !t ||
    /\(aucune t[aâ]che\)/.test(t) ||
    /aucune t[aâ]che explicite/.test(t) ||
    /\(aucune action/.test(t) ||
    /\(aucune question/.test(t) ||
    /aucune d[eé]cision d[eé]j[aà] pos[eé]e/.test(t) ||
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
