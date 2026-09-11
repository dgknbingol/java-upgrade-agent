/**
 * Extract a useful Maven failure excerpt for Copilot.
 * Prefer innermost actionable causes (NoClassDefFoundError, POM errors)
 * over cascade wrappers (Failed to load ApplicationContext / threshold exceeded).
 */

const NOISE_LINE =
  /CONDITIONS EVALUATION REPORT|Positive matches:|Negative matches:|Exclusions:|Unconditional classes:|None\s*$|log4j:WARN|ByteBuddy|Dynamic loading of agents|Sharing is only supported|A Java agent has been loaded/i;

/** Cascade wrappers — never treat these as the primary root by themselves. */
const CASCADE_ONLY =
  /ApplicationContext failure threshold \(\d+\) exceeded/i;

/**
 * Highest → lowest priority. Innermost classpath / POM / analysis beats
 * outer "Failed to load ApplicationContext" noise.
 */
const PRIORITY_MARKERS: RegExp[] = [
  /'dependencies\.dependency\.version'.*is missing/i,
  /Non-resolvable parent POM|Could not find artifact|Failure to find/i,
  /ProjectBuildingException|must be a valid project/i,
  /APPLICATION FAILED TO START/i,
  /Description:\s*$/i,
  /required a single bean, but \d+ were found/i,
  /expected single matching bean but found/i,
  /No qualifying bean of type/i,
  /NoClassDefFoundError/i,
  /ClassNotFoundException/i,
  /NoSuchMethodError/i,
  /MethodNotFoundException/i,
  /COMPILATION ERROR/i,
  /cannot find symbol/i,
  /package .+ does not exist/i,
  /Error creating bean with name/i,
  /BeanCreationException/i,
  /UnsatisfiedDependencyException/i,
  /Caused by:\s*(?!org\.springframework\.test)/i,
  /Failed to load ApplicationContext/i,
];

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function isSkippableCascadeLine(line: string): boolean {
  if (CASCADE_ONLY.test(line)) return true;
  return false;
}

function findFirstRootIndex(lines: string[]): number {
  for (const re of PRIORITY_MARKERS) {
    for (let i = 0; i < lines.length; i++) {
      if (isSkippableCascadeLine(lines[i])) continue;
      if (re.test(lines[i])) {
        return Math.max(0, i - 3);
      }
    }
  }
  return -1;
}

/**
 * Pull compact "Caused by" / NoClassDefFound lines so the model sees them
 * even when the window starts on a cascade wrapper.
 */
function extractKeyCauseLines(lines: string[], max = 12): string[] {
  const keyRe =
    /Caused by:|NoClassDefFoundError|ClassNotFoundException|NoSuchMethodError|APPLICATION FAILED TO START|Description:|Action:|expected single matching bean|No qualifying bean|dependency\.version.*missing|cannot find symbol|Error creating bean with name/i;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t || !keyRe.test(t)) continue;
    if (CASCADE_ONLY.test(t)) continue;
    // Skip huge Spring config dump lines
    if (t.length > 500 && /WebMergedContextConfiguration|contextCustomizers/i.test(t)) continue;
    const norm = t.slice(0, 300);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(t.length > 400 ? `${t.slice(0, 400)}…` : t);
    if (out.length >= max) break;
  }
  return out;
}

function stripNoise(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (NOISE_LINE.test(t)) return false;
    if (/^-{5,}$/.test(t)) return false;
    // Drop huge Spring test config one-liners (they drown the real cause)
    if (t.length > 800 && /WebMergedContextConfiguration|SpringBootTestAnnotation/i.test(t)) {
      return false;
    }
    return true;
  });
}

function takeWindow(lines: string[], start: number, maxChars: number): string {
  let out = '';
  for (let i = start; i < lines.length; i++) {
    const next = out.length === 0 ? lines[i] : `${out}\n${lines[i]}`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}

function takeTail(lines: string[], maxChars: number): string {
  let out = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const next = out.length === 0 ? lines[i] : `${lines[i]}\n${out}`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}

/**
 * Prefer root-cause window + key causes + short build-summary tail.
 */
export function extractMavenFailureExcerpt(buildLog: string, maxChars: number): string {
  const budget = Math.max(2000, maxChars);
  const lines = stripNoise(splitLines(buildLog));
  if (lines.length === 0) {
    return buildLog.slice(-budget);
  }

  const keyCauses = extractKeyCauseLines(lines);
  const rootIdx = findFirstRootIndex(lines);
  const summaryBudget = Math.min(2000, Math.floor(budget * 0.2));
  const keyBudget = Math.min(2500, Math.floor(budget * 0.25));
  const rootBudget = budget - summaryBudget - (keyCauses.length > 0 ? keyBudget : 0);

  const summary = takeTail(lines, summaryBudget);

  const note = [
    'NOTE: Prefer lines under KEY CAUSES (NoClassDefFoundError, bean errors, POM errors).',
    'Ignore "Failed to load ApplicationContext" / "failure threshold exceeded" unless no deeper Caused by exists.',
  ].join('\n');

  const parts: string[] = [note];

  if (keyCauses.length > 0) {
    parts.push('', '=== KEY CAUSES (read these first) ===', keyCauses.join('\n'));
  }

  if (rootIdx < 0) {
    parts.push('', '=== LOG TAIL ===', takeTail(lines, rootBudget));
  } else {
    parts.push('', '=== ROOT CAUSE REGION ===', takeWindow(lines, rootIdx, rootBudget));
  }

  if (summary.trim()) {
    parts.push('', '=== BUILD SUMMARY (tail) ===', summary);
  }

  let result = parts.join('\n');
  if (result.length > budget) {
    // Keep KEY CAUSES; trim root region
    result = result.slice(0, budget);
  }
  return result;
}

/** Exported for unit-style checks / future tests */
export function __testOnly_findFirstRootIndex(lines: string[]): number {
  return findFirstRootIndex(lines);
}
