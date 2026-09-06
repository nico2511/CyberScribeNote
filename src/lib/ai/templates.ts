export type TemplateId = "daily" | "meeting" | "reading" | "project";

export interface NoteTemplate {
  id: TemplateId;
  label: string;
  body: string;
}

const TODAY = () => new Date().toISOString().slice(0, 10);

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "daily",
    label: "Daily note",
    body: `# Daily — ${TODAY()}

## Focus
-

## Notes
-

## Tâches
- [ ]

## Bilan
-
`,
  },
  {
    id: "meeting",
    label: "Compte-rendu",
    body: `# Compte-rendu — ${TODAY()}

## Participants
-

## Ordre du jour
1.

## Décisions
-

## Actions
- [ ]

## Suite
-
`,
  },
  {
    id: "reading",
    label: "Fiche de lecture",
    body: `# Fiche de lecture

## Source
-

## Résumé
-

## Idées clés
-

## Citations
>

## Liens avec mes notes
- [[]]
`,
  },
  {
    id: "project",
    label: "Journal de projet",
    body: `# Projet —

## Objectif
-

## Statut
-

## Journal
### ${TODAY()}
-

## Prochaines étapes
- [ ]
`,
  },
];

export function pickTemplateId(markdown: string, noteContext?: string): TemplateId {
  const t = `${noteContext ?? ""}\n${markdown}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/\b(reunion|meeting|cr |compte[- ]rendu|participants)\b/.test(t)) return "meeting";
  if (/\b(lecture|livre|article|fiche|paper)\b/.test(t)) return "reading";
  if (/\b(projet|project|roadmap|milestone)\b/.test(t)) return "project";
  if (!markdown.trim()) return "daily";
  return "daily";
}

export function buildTemplateMarkdown(
  markdown: string,
  noteContext?: string,
  preferred?: TemplateId,
): { proposed: string; reason: string } {
  const id = preferred ?? pickTemplateId(markdown, noteContext);
  const tpl = NOTE_TEMPLATES.find((t) => t.id === id) ?? NOTE_TEMPLATES[0];
  if (!markdown.trim()) {
    return {
      proposed: tpl.body.trim() + "\n",
      reason: `Template « ${tpl.label} » (note vide).`,
    };
  }
  return {
    proposed: `\n\n---\n\n## Template · ${tpl.label}\n\n${tpl.body.trim()}\n`,
    reason: `Template « ${tpl.label} » à ajouter / adapter.`,
  };
}
