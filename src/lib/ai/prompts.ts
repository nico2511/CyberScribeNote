export const AI_PROMPTS = {
  summarize: (content: string) =>
    `Résume cette note en français en 3 à 5 phrases concises :\n\n${content}`,
  reformulate: (content: string) =>
    `Reformule ce texte en français, plus clair et fluide, sans changer le sens :\n\n${content}`,
  correct: (content: string) =>
    `Corrige l'orthographe et la grammaire de ce texte en français :\n\n${content}`,
  translateEn: (content: string) =>
    `Traduis ce texte en anglais :\n\n${content}`,
} as const;
