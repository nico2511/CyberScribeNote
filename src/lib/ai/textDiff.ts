export interface DiffSegment {
  text: string;
  kind: "same" | "removed" | "added";
}

/** Diff mot à mot (simple) pour surligner les zones problématiques. */
export function diffWords(original: string, proposed: string): DiffSegment[] {
  const a = tokenize(original);
  const b = tokenize(proposed);
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        normalizeToken(a[i]) === normalizeToken(b[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && normalizeToken(a[i]) === normalizeToken(b[j])) {
      pushSeg(segments, "same", a[i]);
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      pushSeg(segments, "added", b[j]);
      j++;
    } else if (i < n) {
      pushSeg(segments, "removed", a[i]);
      i++;
    }
  }

  return mergeAdjacent(segments);
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['']/g, "'");
}

function pushSeg(segments: DiffSegment[], kind: DiffSegment["kind"], text: string) {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
  } else {
    segments.push({ kind, text });
  }
}

function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
  return segments;
}

export function hasMeaningfulDiff(original: string, proposed: string): boolean {
  return diffWords(original, proposed).some((s) => s.kind !== "same");
}
