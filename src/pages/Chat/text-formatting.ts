const READABLE_PARAGRAPH_MIN_LENGTH = 48;
const TARGET_SEGMENT_LENGTH = 96;
const HARD_SEGMENT_LENGTH = 150;

export interface TaskProgressPresentation {
  intro: string | null;
  steps: string[];
}

function isMarkdownBlockStart(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    /^#{1,6}\s/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^\|.*\|$/.test(trimmed) ||
    /^-{3,}$/.test(trimmed) ||
    /^={3,}$/.test(trimmed) ||
    /^```/.test(trimmed)
  );
}

function isStructuredParagraph(paragraph: string): boolean {
  const lines = paragraph.split('\n');
  return lines.length > 1 || lines.some(isMarkdownBlockStart);
}

function splitByPunctuation(paragraph: string, punctuation: RegExp): string[] {
  const segments: string[] = [];
  let start = 0;
  punctuation.lastIndex = 0;

  for (const match of paragraph.matchAll(punctuation)) {
    const end = (match.index ?? 0) + match[0].length;
    const chunk = paragraph.slice(start, end).trim();
    if (chunk) segments.push(chunk);
    start = end;
  }

  const tail = paragraph.slice(start).trim();
  if (tail) segments.push(tail);
  return segments.length > 0 ? segments : [paragraph.trim()];
}

function splitSentences(text: string): string[] {
  return splitByPunctuation(text.trim(), /[。！？；.!?;]+\s*/g);
}

function joinAdjacentSegment(left: string, right: string): string {
  if (!left) return right;
  if (/[.!?;:]$/.test(left) && /^[A-Za-z0-9]/.test(right)) {
    return `${left} ${right}`;
  }
  return `${left}${right}`;
}

function mergeReadableSegments(segments: string[]): string[] {
  const merged: string[] = [];
  let buffer = '';

  for (const segment of segments) {
    if (!segment) continue;
    const next = joinAdjacentSegment(buffer, segment);
    if (next.length < TARGET_SEGMENT_LENGTH) {
      buffer = next;
      continue;
    }
    merged.push(next);
    buffer = '';
  }

  if (buffer) {
    if (merged.length > 0 && buffer.length < 36) {
      merged[merged.length - 1] = joinAdjacentSegment(merged[merged.length - 1], buffer);
    } else {
      merged.push(buffer);
    }
  }

  return merged;
}

function mergeShortOpeningSegment(segments: string[]): string[] {
  if (segments.length < 2 || segments[0].length >= 12) return segments;
  return [joinAdjacentSegment(segments[0], segments[1]), ...segments.slice(2)];
}

function startsWithProgressCue(sentence: string): boolean {
  const trimmed = sentence.trim();
  return /^(让我先|我会先|我先|先|然后|接着|接下来|下一步|随后|现在|开始|最后|同时)/.test(trimmed);
}

function normalizeProgressStep(sentence: string): string {
  return sentence
    .trim()
    .replace(/^(让我先|我会先|我先|先)/, '')
    .replace(/^(然后|接着|接下来|下一步|随后|最后|同时)/, '')
    .replace(/^现在(?:我|开始)?/, '')
    .replace(/^开始/, '')
    .trim();
}

function hasMarkdownOrCode(text: string): boolean {
  return text.includes('```') || text.split('\n').some(isMarkdownBlockStart);
}

export function parseTaskProgressText(text: string): TaskProgressPresentation | null {
  const trimmed = text.trim();
  if (trimmed.length < READABLE_PARAGRAPH_MIN_LENGTH || hasMarkdownOrCode(trimmed)) return null;

  const sentences = mergeShortOpeningSegment(splitSentences(trimmed));
  if (sentences.length < 2) return null;

  const firstStepIndex = sentences.findIndex(startsWithProgressCue);
  if (firstStepIndex < 0) return null;

  const intro = sentences.slice(0, firstStepIndex).join('').trim() || null;
  const steps: string[] = [];

  for (const sentence of sentences.slice(firstStepIndex)) {
    if (startsWithProgressCue(sentence)) {
      const step = normalizeProgressStep(sentence);
      if (step) steps.push(step);
      continue;
    }

    if (steps.length === 0) {
      steps.push(sentence.trim());
    } else {
      steps[steps.length - 1] = joinAdjacentSegment(steps[steps.length - 1], sentence.trim());
    }
  }

  if (steps.length >= 2 || (intro && steps.length >= 1)) {
    return { intro, steps };
  }

  return null;
}

function splitReadableParagraph(paragraph: string): string {
  const trimmed = paragraph.trim();
  if (trimmed.length < READABLE_PARAGRAPH_MIN_LENGTH || isStructuredParagraph(trimmed)) {
    return paragraph;
  }

  const sentenceSegments = splitByPunctuation(trimmed, /[。！？；.!?;]+\s*/g);
  let segments =
    sentenceSegments.length >= 3
      ? mergeShortOpeningSegment(sentenceSegments)
      : mergeReadableSegments(sentenceSegments);

  if (segments.some((segment) => segment.length > HARD_SEGMENT_LENGTH)) {
    segments = segments.flatMap((segment) => {
      if (segment.length <= HARD_SEGMENT_LENGTH) return [segment];
      return mergeReadableSegments(splitByPunctuation(segment, /[，、,：:]\s*/g));
    });
  }

  return segments.length > 1 ? segments.join('\n\n') : paragraph;
}

function formatNonCodeBlock(block: string): string {
  return block
    .split(/\n{2,}/)
    .map(splitReadableParagraph)
    .join('\n\n');
}

export function formatReadableText(text: string): string {
  if (!text || text.length < READABLE_PARAGRAPH_MIN_LENGTH) return text;
  if (!text.includes('```')) return formatNonCodeBlock(text);

  const parts: string[] = [];
  const codeFence = /```[\s\S]*?(?:```|$)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(codeFence)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(formatNonCodeBlock(text.slice(lastIndex, index)));
    }
    parts.push(match[0]);
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(formatNonCodeBlock(text.slice(lastIndex)));
  }

  return parts.join('');
}
