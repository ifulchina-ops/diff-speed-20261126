// Fast drop-in for makefun-diff 1.0.0.
//
// Returns exactly makefun-diff's patch of { old, new } (see the house baseline's
// vendor/makefun-diff/index.js for the rule), but computed with a tight integer
// Myers search instead of the reference's linked-list paths, so it runs several
// times faster on the same cases.
//
// The rule, restated: a text is cut into lines after every "\n" (a "\r" is part
// of its line; a last line with no "\n" is a line too); the common prefix of
// lines is kept, then the common suffix of what is left; between them Myers's
// greedy search runs from the first lines, keeping on each diagonal the path
// reaching furthest into the old text and, when a deletion and an insertion
// reach the same point, the deletion's; it never moves past either text's end,
// prunes no edge diagonal, and follows every run of lines equal in both as far
// as it goes; the first path to reach both ends is the script. The patch lists
// deletions before insertions in each change run, shows up to 3 kept lines
// before and after each run, and merges runs at most 6 kept lines apart into
// one hunk; a line with no trailing newline is written with one and followed
// by a "%" line. Identical texts are the first line alone.
//
// Speed notes: lines are interned to small integers once (a Map from line to
// id), so the search and its snakes compare integers in flat Int32Arrays. The
// search keeps one flat Int32Array of V rows (row d starts at d*(d+1)/2, value
// x or -1 for no path) instead of allocating a path object per diagonal, and
// the script is rebuilt from those rows by walking d back down. Nothing is
// cached between cases: every run() call interns and searches from scratch,
// and the output depends only on the two input strings.

/** The patch's first word. */
export const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
export const CONTEXT = 3;

/** The op of a kept, a deleted and an inserted line, as the patch writes them. */
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const lines = new Array(parts.length);
  for (let i = 0; i < last; i++) lines[i] = parts[i] + '\n';
  if (parts[last] !== '') lines[last] = parts[last];
  else lines.length = last;
  return lines;
}

/**
 * The runs of the edit script of a into b: [{ kind, count }], in order.
 * a and b hold interned line ids of the middle slices (after the common
 * prefix and suffix were cut). Identical to makefun-diff's editRuns on the
 * same slices: same greedy search, same deletion-on-tie rule, same end
 * checks, same first-path-to-the-end.
 */
function editRuns(a, b) {
  const N = a.length;
  const M = b.length;
  // Flat V storage: row d starts at d*(d+1)/2 and holds d+1 entries, one per
  // diagonal k = -d, -d+2, ..., d (index j = (k+d)/2). An entry is the x the
  // furthest path on that diagonal reaches after its snake, or -1 when no
  // path reaches the diagonal at all.
  let cap = 1 << 22;
  let V = new Int32Array(cap);
  const rowStart = (d) => (d * (d + 1)) >> 1;
  const ensure = (need) => {
    if (need <= cap) return;
    let next = cap;
    while (next < need) next *= 2;
    const grown = new Int32Array(next);
    grown.set(V.subarray(0, cap));
    V = grown;
    cap = next;
  };

  // d = 0: the opening snake from (0, 0).
  let x = 0;
  let y = 0;
  while (x < N && y < M && a[x] === b[y]) { x++; y++; }
  V[0] = x;
  let D = -1;
  let kEnd = 0;
  if (x === N && y === M) {
    D = 0;
  } else {
    for (let d = 1; D < 0; d++) {
      const rs = rowStart(d);
      const ps = rowStart(d - 1);
      ensure(rs + d + 1);
      // rem slides: the insertion path of j is the deletion path of j+1.
      let rem = -1;
      for (let j = 0, k = -d; j <= d; j++, k += 2) {
        const add = j < d ? V[ps + j] : -1;
        // A move past the end of either text is no candidate.
        const canRemove = rem >= 0 && rem < N;
        const canAdd = add >= 0 && add - k - 1 < M;
        if (!canRemove && !canAdd) {
          V[rs + j] = -1;
          rem = add;
          continue;
        }
        // The candidate further into the old text, the deletion on a tie.
        const del = canRemove && (!canAdd || rem + 1 >= add);
        x = del ? rem + 1 : add;
        y = x - k;
        // The snake: every run of lines equal in both, as far as it goes.
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        V[rs + j] = x;
        if (x === N && y === M) {
          D = d;
          kEnd = k;
          break;
        }
        rem = add;
      }
    }
  }

  // Walk d back down, recovering one edit and its snake per step. The list is
  // built in reverse, then flipped; adjacent runs of one kind are merged,
  // exactly as the reference's path components merge them.
  const segs = [];
  let k = kEnd;
  for (let d = D; d >= 1; d--) {
    const rs = rowStart(d);
    const ps = rowStart(d - 1);
    const j = (k + d) >> 1;
    const xD = V[rs + j];
    const rem = j > 0 ? V[ps + j - 1] : -1;
    const add = j < d ? V[ps + j] : -1;
    const canRemove = rem >= 0 && rem < N;
    const canAdd = add >= 0 && add - k - 1 < M;
    const del = canRemove && (!canAdd || rem + 1 >= add);
    const sx = del ? rem + 1 : add;
    const snake = xD - sx;
    if (snake > 0) segs.push({ kind: KEEP, count: snake });
    segs.push({ kind: del ? DELETE : INSERT, count: 1 });
    k = del ? k - 1 : k + 1;
  }
  if (V[0] > 0) segs.push({ kind: KEEP, count: V[0] });
  segs.reverse();
  const runs = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === s.kind) last.count += s.count;
    else runs.push({ kind: s.kind, count: s.count });
  }
  return runs;
}

/** A line as the patch writes it: op, the line, a newline, and "%" on a line of its own when it had none. */
function pushLine(out, op, line) {
  if (line.endsWith('\n')) {
    out.push(op, line);
  } else {
    out.push(op, line, '\n%\n');
  }
}

/** make.fun's own patch of old into new, as one string. */
export function diffPatch(oldText, newText) {
  const oldLines = tokenize(oldText);
  const newLines = tokenize(newText);
  const n = oldLines.length;
  const m = newLines.length;

  // Intern both texts' lines to integers with one shared table, so every
  // comparison in the search is an integer comparison.
  const ids = new Map();
  const A = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const s = oldLines[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = ids.size;
      ids.set(s, id);
    }
    A[i] = id;
  }
  const B = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const s = newLines[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = ids.size;
      ids.set(s, id);
    }
    B[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(A.subarray(prefix, n - suffix), B.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) pushLine(out, KEEP, oldLines[at]);
      for (let i = 0; i < c.dels; i++) pushLine(out, DELETE, oldLines[c.o + i]);
      for (let i = 0; i < c.ins; i++) pushLine(out, INSERT, newLines[c.p + i]);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) pushLine(out, KEEP, oldLines[at]);
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  return diffPatch(input.old, input.new);
}
