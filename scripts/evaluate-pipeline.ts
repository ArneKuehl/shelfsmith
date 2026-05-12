import { readFileSync } from "fs";
import { runPipeline } from "../src/lib/pipeline/index";
import { jaroWinkler } from "../src/lib/cluster";

const duplicatesPath = new URL("../duplicates.json", import.meta.url).pathname;
const raw = JSON.parse(readFileSync(duplicatesPath, "utf-8")) as Record<string, string[]>;

type Result = {
  dirty: string;
  expected: string;
  got: string;
  pattern: string;
  confidence: number;
  exact: boolean;
  close: boolean;
};

const results: Result[] = [];
const patternCounts = new Map<string, { total: number; exact: number; close: number }>();

let totalPairs = 0;
let exactMatches = 0;
let closeMatches = 0;

for (const [clean, dirtyList] of Object.entries(raw)) {
  for (const dirty of dirtyList) {
    totalPairs++;
    const result = runPipeline(dirty);
    const got = result.proposedName;
    const exact = got === clean;
    const jw = jaroWinkler(got.toLowerCase(), clean.toLowerCase());
    const close = !exact && jw > 0.9;

    if (exact) exactMatches++;
    if (close) closeMatches++;

    const pat = result.matchedPattern;
    const existing = patternCounts.get(pat) ?? { total: 0, exact: 0, close: 0 };
    existing.total++;
    if (exact) existing.exact++;
    if (close) existing.close++;
    patternCounts.set(pat, existing);

    results.push({ dirty, expected: clean, got, pattern: pat, confidence: result.overallConfidence, exact, close });
  }
}

console.log("=== Pipeline Evaluation ===");
console.log(`Total dirty→clean pairs: ${totalPairs}`);
console.log(`Exact matches:        ${exactMatches} (${(100 * exactMatches / totalPairs).toFixed(1)}%)`);
console.log(`Close matches (>0.9): ${closeMatches} (${(100 * closeMatches / totalPairs).toFixed(1)}%)`);
console.log(`Combined:             ${exactMatches + closeMatches} (${(100 * (exactMatches + closeMatches) / totalPairs).toFixed(1)}%)`);
console.log(`Misses:               ${totalPairs - exactMatches - closeMatches} (${(100 * (totalPairs - exactMatches - closeMatches) / totalPairs).toFixed(1)}%)`);

console.log("\nBy matched pattern:");
const sortedPatterns = [...patternCounts.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [pat, { total, exact, close }] of sortedPatterns) {
  const pct = (100 * exact / total).toFixed(1);
  const closePct = (100 * (exact + close) / total).toFixed(1);
  console.log(`  ${pat.padEnd(35)} ${String(exact).padStart(4)}/${String(total).padStart(4)} exact (${pct}%)  |  +${close} close (${closePct}%)`);
}

const confBuckets = { high: 0, medium: 0, low: 0 };
for (const r of results) {
  if (r.confidence >= 0.7) confBuckets.high++;
  else if (r.confidence >= 0.4) confBuckets.medium++;
  else confBuckets.low++;
}
console.log("\nBy confidence level:");
console.log(`  high (≥0.7):       ${confBuckets.high}`);
console.log(`  medium (0.4–0.7):  ${confBuckets.medium}`);
console.log(`  low (<0.4):        ${confBuckets.low}`);

const failures = results
  .filter((r) => !r.exact && !r.close)
  .sort((a, b) => b.confidence - a.confidence);

console.log(`\nTop 30 failures:`);
for (const f of failures.slice(0, 30)) {
  console.log(`  dirty:      ${f.dirty.slice(0, 100)}`);
  console.log(`  expected:   ${f.expected.slice(0, 100)}`);
  console.log(`  got:        ${f.got.slice(0, 100)}`);
  console.log(`  pattern:    ${f.pattern}  confidence: ${f.confidence.toFixed(2)}`);
  console.log();
}
