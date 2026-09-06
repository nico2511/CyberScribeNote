import { extractOutline } from "$lib/markdown/bridge";
import { bodyHasTypoLines } from "$lib/note/scanTypos";
import { extractUrls, isLinkOnlyNote } from "$lib/ai/links";
import type { SkillId } from "$lib/ai/skills";

export type BuddyMood = "idle" | "listen" | "think" | "idea" | "ok" | "warn";

export type BuddyAction =
  | { kind: "open_companion" }
  | { kind: "skill"; skillId: SkillId }
  | { kind: "dismiss" };

export interface BuddyTip {
  id: string;
  mood: BuddyMood;
  message: string;
  actionLabel?: string;
  action?: BuddyAction;
  priority: number;
}

export interface BuddyScanInput {
  markdown: string;
  typing: boolean;
  busy: boolean;
  hasSuggestions: boolean;
  noteOpen: boolean;
  /** true si le RAG a déjà des hits pour cette note (précalculé). */
  hasRelated?: boolean;
}

function fenceUnclosed(md: string): boolean {
  let open = false;
  for (const line of md.split("\n")) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) open = !open;
  }
  return open;
}

function hasEmptyHeading(md: string): boolean {
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{1,6}\s*$/.test(line)) return true;
  }
  return false;
}

function hasBareComposeFence(md: string): boolean {
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].trim().match(/^```(.*)$/);
    if (!open) {
      i++;
      continue;
    }
    const lang = (open[1] || "").trim();
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith("```")) j++;
    const inner = lines.slice(i + 1, j).join("\n");
    if (!lang && /^\s*(version|services):\s*/m.test(inner) && /image:\s+\S/m.test(inner)) {
      return true;
    }
    i = j + 1;
  }
  return false;
}

function hasSommaire(md: string): boolean {
  return /^##\s+(Sommaire|Table des mati[eè]res|TOC)\s*$/im.test(md);
}

export function scanBuddyTip(input: BuddyScanInput): BuddyTip | null {
  if (!input.noteOpen) return null;

  if (input.busy) {
    return {
      id: "busy",
      mood: "think",
      message: "Je réfléchis…",
      priority: 100,
    };
  }

  if (input.typing) {
    return {
      id: "typing",
      mood: "listen",
      message: "J'écoute.",
      priority: 90,
    };
  }

  const body = input.markdown.trim();
  if (!body) {
    return {
      id: "empty",
      mood: "idle",
      message: "Note vide — un template daily ?",
      actionLabel: "Template",
      action: { kind: "skill", skillId: "template" },
      priority: 10,
    };
  }

  if (isLinkOnlyNote(body) || (extractUrls(body).length === 1 && body.length < 280)) {
    return {
      id: "link-only",
      mood: "idea",
      message: "Un lien — je peux enrichir la note.",
      actionLabel: "Enrichir",
      action: { kind: "skill", skillId: "enrich" },
      priority: 85,
    };
  }

  if (fenceUnclosed(body)) {
    return {
      id: "fence-open",
      mood: "warn",
      message: "Un bloc de code n'est pas refermé.",
      actionLabel: "Structurer",
      action: { kind: "skill", skillId: "structure" },
      priority: 80,
    };
  }

  if (hasEmptyHeading(body)) {
    return {
      id: "empty-heading",
      mood: "idea",
      message: "Titre vide — je peux le nommer.",
      actionLabel: "Structurer",
      action: { kind: "skill", skillId: "structure" },
      priority: 70,
    };
  }

  if (hasBareComposeFence(body)) {
    return {
      id: "bare-fence",
      mood: "idea",
      message: "Blocs de code sans langage.",
      actionLabel: "Structurer",
      action: { kind: "skill", skillId: "structure" },
      priority: 65,
    };
  }

  const headings = extractOutline(body).filter((h) => h.level >= 2);
  if (headings.length >= 3 && !hasSommaire(body)) {
    return {
      id: "outline",
      mood: "idea",
      message: "Plusieurs sections — un sommaire ?",
      actionLabel: "Sommaire",
      action: { kind: "skill", skillId: "outline" },
      priority: 55,
    };
  }

  if (input.hasRelated && body.length > 120) {
    return {
      id: "related",
      mood: "idea",
      message: "Des notes du vault semblent proches.",
      actionLabel: "Liées",
      action: { kind: "skill", skillId: "related" },
      priority: 52,
    };
  }

  if (bodyHasTypoLines(body)) {
    return {
      id: "typos",
      mood: "warn",
      message: "Quelques fautes possibles.",
      actionLabel: "Compagnon",
      action: { kind: "open_companion" },
      priority: 50,
    };
  }

  if (input.hasSuggestions) {
    return {
      id: "pending",
      mood: "idea",
      message: "Une suggestion t'attend.",
      actionLabel: "Voir",
      action: { kind: "open_companion" },
      priority: 40,
    };
  }

  if (body.length > 280 && !/tags:\s*\[/i.test(body)) {
    return {
      id: "tags",
      mood: "idea",
      message: "Je peux proposer des tags.",
      actionLabel: "Tags",
      action: { kind: "skill", skillId: "tags" },
      priority: 20,
    };
  }

  if (body.length > 400) {
    return {
      id: "presence",
      mood: "ok",
      message: "Note en cours — brief ou plan ?",
      actionLabel: "Brief",
      action: { kind: "skill", skillId: "brief" },
      priority: 15,
    };
  }

  return {
    id: "idle",
    mood: "idle",
    message: "Prêt.",
    priority: 5,
  };
}

export function moodFromActivity(typing: boolean, busy: boolean): BuddyMood {
  if (busy) return "think";
  if (typing) return "listen";
  return "idle";
}
