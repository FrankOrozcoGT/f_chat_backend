interface AnalysisWithIntent {
  id: string;
  conversationId: string;
  intent: string | null;
  intentDescription?: string | null;
  flowSummary: string | null;
  flowDiagram: string | null;
}

export function groupAnalysesByIntent<T extends AnalysisWithIntent>(
  analyses: T[],
  normalizationMap?: Map<string, string>,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const analysis of analyses) {
    if (!analysis.intent) continue;
    const key = normalizationMap?.get(analysis.intent) ?? analysis.intent;
    const existing = map.get(key) ?? [];
    existing.push(analysis);
    map.set(key, existing);
  }
  return map;
}
