import { loadJson, saveJson, type EventEntry, type RootCauseEntry, type TimingBaseline } from "../knowledge/loader.js";

interface ContributeEventInput {
  eventName: string;
  description: string;
  category?: string;
  severity?: string;
  params?: { index: number; name: string; type: string; description: string }[];
  relatedEvents?: string[];
  sourceFile?: string;
  contributor?: string;
}

interface ContributeRootCauseInput {
  key: string;
  symptom: string;
  rootCause: string;
  evidence: string[];
  classification: string;
  resolution: string[];
  codeReferences?: string[];
  discoveredFrom?: string;
  discoveredBy?: string;
}

interface ContributeTimingInput {
  key: string;
  observedMs: number;
  notes?: string;
}

export function contributeEvent(input: ContributeEventInput): string {
  const events = loadJson<Record<string, EventEntry>>("events.json");

  const existing = events[input.eventName];
  if (existing) {
    // Merge — don't overwrite, only add missing info
    let merged = false;
    if (input.params && input.params.length > 0 && existing.params.length === 0) {
      existing.params = input.params;
      merged = true;
    }
    if (input.sourceFile && !existing.sourceFile) {
      existing.sourceFile = input.sourceFile;
      merged = true;
    }
    if (input.relatedEvents) {
      const newRelated = input.relatedEvents.filter(e => !existing.relatedEvents.includes(e));
      if (newRelated.length > 0) {
        existing.relatedEvents.push(...newRelated);
        merged = true;
      }
    }
    if (input.contributor) {
      existing.contributors = existing.contributors || [];
      if (!existing.contributors.includes(input.contributor)) {
        existing.contributors.push(input.contributor);
        merged = true;
      }
    }
    existing.lastUpdated = new Date().toISOString().split("T")[0];
    events[input.eventName] = existing;
    saveJson("events.json", events);

    return merged
      ? `✅ Merged new info into existing event \`${input.eventName}\`. Total events: ${Object.keys(events).length}`
      : `ℹ️ Event \`${input.eventName}\` already exists with same info. No changes made.`;
  }

  // New event
  events[input.eventName] = {
    description: input.description,
    category: input.category || "Unknown",
    severity: input.severity || "Info",
    params: input.params || [],
    relatedEvents: input.relatedEvents || [],
    sourceFile: input.sourceFile,
    contributors: input.contributor ? [input.contributor] : [],
    lastUpdated: new Date().toISOString().split("T")[0],
  };
  saveJson("events.json", events);

  return `✅ Added new event \`${input.eventName}\` to knowledge base. Total events: ${Object.keys(events).length}`;
}

export function contributeRootCause(input: ContributeRootCauseInput): string {
  const rootCauses = loadJson<Record<string, RootCauseEntry>>("root_causes.json");

  if (rootCauses[input.key]) {
    return `⚠️ Root cause "${input.key}" already exists. Use a different key or manually edit root_causes.json.`;
  }

  rootCauses[input.key] = {
    symptom: input.symptom,
    rootCause: input.rootCause,
    evidence: input.evidence,
    classification: input.classification,
    resolution: input.resolution,
    codeReferences: input.codeReferences || [],
    discoveredFrom: input.discoveredFrom,
    discoveredBy: input.discoveredBy,
    date: new Date().toISOString().split("T")[0],
  };
  saveJson("root_causes.json", rootCauses);

  return `✅ Added root cause "${input.key}" to knowledge base. Total root causes: ${Object.keys(rootCauses).length}`;
}

export function contributeTiming(input: ContributeTimingInput): string {
  const baselines = loadJson<Record<string, TimingBaseline>>("timing_baselines.json");

  const existing = baselines[input.key];
  if (existing) {
    // Update with running statistics (simplified — uses new observation to shift estimates)
    const n = existing.sampleCount + 1;
    // Simple moving average for p50, keep p95/p99 as max observed
    existing.p50_ms = Math.round((existing.p50_ms * existing.sampleCount + input.observedMs) / n);
    existing.p95_ms = Math.max(existing.p95_ms, input.observedMs);
    existing.p99_ms = Math.max(existing.p99_ms, input.observedMs);
    existing.sampleCount = n;
    if (input.notes) {
      existing.notes += ` | ${input.notes}`;
    }
    baselines[input.key] = existing;
    saveJson("timing_baselines.json", baselines);

    return `✅ Updated timing baseline "${input.key}" with new observation: ${input.observedMs}ms. Samples: ${n}`;
  }

  // New baseline
  baselines[input.key] = {
    p50_ms: input.observedMs,
    p95_ms: input.observedMs,
    p99_ms: input.observedMs,
    notes: input.notes || "",
    sampleCount: 1,
  };
  saveJson("timing_baselines.json", baselines);

  return `✅ Created new timing baseline "${input.key}": ${input.observedMs}ms. Total baselines: ${Object.keys(baselines).length}`;
}
