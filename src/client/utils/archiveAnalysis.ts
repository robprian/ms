export function parseArchiveAnalysisResponse(response: unknown): Record<string, any> {
  if (response && typeof response === 'object') {
    return response as Record<string, any>;
  }

  if (typeof response !== 'string') {
    throw new Error('Archive analysis result format is invalid');
  }

  const trimmed = response.trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Archive analysis result is not valid JSON, please re-analyze');
  }
}
