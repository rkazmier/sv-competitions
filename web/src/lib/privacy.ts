/** Dzieli tekst klauzuli informacyjnej na akapity (rozdzielone pustą linią). */
export function privacyParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
