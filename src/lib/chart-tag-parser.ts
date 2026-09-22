export interface InChatChartData {
  type: string;
  title: string;
  data: any[];
  config?: {
    xAxisKey?: string;
    dataKeys?: string[];
  };
  query?: string;
  projectId?: string;
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
}

/**
 * Robustly parses and extracts [RENDER_CHART:{...}] tags from AI assistant text.
 * 
 * Standard regex patterns like `\[RENDER_CHART:[^\]]*\]` fail because chart JSON
 * contains nested array square brackets (e.g. `data: [{"day": 1, ...}]`), which causes
 * regexes to prematurely stop at the nested `]`, corrupting the JSON and leaking the remainder
 * (e.g. `,"xKey":"day","yKey":"sales"}]`) into the chat bubble.
 * 
 * This parser uses balanced brace and bracket tracking to cleanly extract the entire
 * JSON payload, parse it into an InChatChartData structure, and strip the entire tag
 * (and any leaked orphan fragments) from the displayed text.
 */
export function extractChartTag(text: string): { chart?: InChatChartData; cleanedText: string } {
  if (!text) return { cleanedText: '' };

  let workingText = text;
  let extractedChart: InChatChartData | undefined = undefined;

  const markerRegex = /\[RENDER_CHART:\s*/gi;
  let match: RegExpExecArray | null;

  interface TagRange {
    start: number;
    end: number;
    chartData?: InChatChartData;
  }
  const tagsToStrip: TagRange[] = [];

  while ((match = markerRegex.exec(workingText)) !== null) {
    const tagStart = match.index;
    const jsonStartCandidate = tagStart + match[0].length;

    // Find the opening '{' of the JSON payload
    let braceStart = -1;
    for (let i = jsonStartCandidate; i < workingText.length; i++) {
      const ch = workingText[i];
      if (/\s/.test(ch)) continue;
      if (ch === '{') {
        braceStart = i;
        break;
      }
      break;
    }

    if (braceStart === -1) {
      // Incomplete or malformed tag without '{'.
      const nextBracket = workingText.indexOf(']', tagStart);
      const tagEnd = nextBracket !== -1 ? nextBracket + 1 : workingText.length;
      tagsToStrip.push({ start: tagStart, end: tagEnd });
      continue;
    }

    // Track brace & bracket depth starting from braceStart
    let depth = 0;
    let inString = false;
    let escape = false;
    let braceEnd = -1;

    for (let i = braceStart; i < workingText.length; i++) {
      const ch = workingText[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{' || ch === '[') {
          depth++;
        } else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            braceEnd = i;
            break;
          }
        }
      }
    }

    if (braceEnd === -1) {
      // Incomplete JSON (e.g. streaming token cutoff) -> strip from tagStart to end of text
      tagsToStrip.push({ start: tagStart, end: workingText.length });
      break;
    }

    const jsonString = workingText.slice(braceStart, braceEnd + 1);
    let parsed: any = undefined;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      try {
        const relaxed = jsonString
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":');
        parsed = JSON.parse(relaxed);
      } catch {}
    }

    if (parsed && typeof parsed === 'object') {
      if (!extractedChart) {
        extractedChart = parsed as InChatChartData;
      }
    }

    // Look for closing ']' after braceEnd
    let tagEnd = braceEnd + 1;
    for (let i = braceEnd + 1; i < workingText.length; i++) {
      const ch = workingText[i];
      if (/\s/.test(ch)) continue;
      if (ch === ']') {
        tagEnd = i + 1;
        break;
      }
      break;
    }

    tagsToStrip.push({
      start: tagStart,
      end: tagEnd,
      chartData: parsed
    });
  }

  // Strip extracted tags in reverse order to preserve indices
  if (tagsToStrip.length > 0) {
    for (let i = tagsToStrip.length - 1; i >= 0; i--) {
      const { start, end } = tagsToStrip[i];
      workingText = workingText.slice(0, start) + workingText.slice(end);
    }
  }

  // Clean up any orphan chart JSON fragments that might have leaked or were previously saved
  workingText = workingText
    .replace(/(?:,\s*"(?:xKey|yKey|xAxisKey|dataKey|type|title)"\s*:\s*(?:"[^"]*"|\[[^\]]*\]|[^,}\]]+)\s*)+[}\]]*/gi, '')
    .replace(/^[ \t]*,"(?:xKey|yKey)"\s*:[^\n]*$/gim, '')
    .replace(/\[RENDER_CHART:[^\]]*$/gi, '')
    .trim();

  return { chart: extractedChart, cleanedText: workingText };
}

/**
 * Strips [RENDER_CHART:...] and any orphan chart fragments from text.
 */
export function stripChartTags(text: string): string {
  return extractChartTag(text).cleanedText;
}
