import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Resolve knowledge base directory — handles tsx, compiled, and npx modes
function getKnowledgeDir(): string {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // 1. Same directory (tsx mode — running from src/knowledge/, or dist with copied JSONs)
    if (existsSync(join(thisDir, "api_ids.json"))) {
      return thisDir;
    }
    // 2. Compiled mode — JSONs in src/knowledge/ relative to dist/knowledge/
    const srcKnowledge = join(thisDir, "..", "..", "src", "knowledge");
    if (existsSync(join(srcKnowledge, "api_ids.json"))) {
      return srcKnowledge;
    }
    // 3. npm/npx mode — knowledge/ sibling to dist/ in package root
    const pkgKnowledge = join(thisDir, "..", "..", "knowledge");
    if (existsSync(join(pkgKnowledge, "api_ids.json"))) {
      return pkgKnowledge;
    }
    return thisDir;
  } catch {
    return join(process.cwd(), "src", "knowledge");
  }
}

export function loadJson<T>(filename: string): T {
  const filePath = join(getKnowledgeDir(), filename);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function saveJson<T>(filename: string, data: T): void {
  const filePath = join(getKnowledgeDir(), filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export interface ApiIdEntry {
  name: string;
  category: string;
  critical?: boolean;
}

export interface EventParam {
  index: number;
  name: string;
  type: string;
  description: string;
}

export interface EventEntry {
  description: string;
  category: string;
  severity: string;
  params: EventParam[];
  relatedEvents: string[];
  sourceFile?: string;
  contributors?: string[];
  lastUpdated?: string;
}

export interface RootCauseEntry {
  symptom: string;
  rootCause: string;
  evidence: string[];
  classification: string;
  resolution: string[];
  codeReferences: string[];
  discoveredFrom?: string;
  discoveredBy?: string;
  date?: string;
}

export interface TimingBaseline {
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  notes: string;
  sampleCount: number;
}
