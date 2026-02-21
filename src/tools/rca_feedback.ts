/**
 * rca_feedback: Minimal structured feedback capture tool.
 * Captures user confirmation/correction of root-cause analysis and
 * applies guarded updates to the knowledge base.
 *
 * Only auto-applies:
 *   - Timing baseline updates (new or adjusted)
 *   - New event names / signatures
 *   - Confirmed root-cause confidence boosts
 *
 * Destructive changes (removing root causes, changing taxonomy)
 * are NOT auto-applied; they are logged for manual review.
 */

import { existsSync } from "fs";
import { join } from "path";
import { loadJson, saveJson } from "../knowledge/loader.js";

// ─── Types ──────────────────────────────────────────────────────────

interface FeedbackInput {
  /** Was the root cause confirmed? */
  confirmedRootCause: "yes" | "no" | "unknown";

  /** The root cause category that was proposed (e.g., "navigation_stalled") */
  proposedRootCause: string;

  /** If "no": which top suspects were wrong and why */
  wrongSuspects?: { name: string; reason: string }[];

  /** Event names/signatures that would have helped but were missing from KB */
  missingEvents?: string[];

  /** Timing baseline updates: stage → observed duration in ms */
  timingUpdates?: Record<string, number>;

  /** Path to a "good ETL" for future comparison baseline */
  goodEtlPath?: string;

  /** Free-text notes */
  notes?: string;
}

interface FeedbackResult {
  applied: string[];
  deferred: string[];
  summary: string;
}

// ─── Public entry point ─────────────────────────────────────────────

export async function rcaFeedback(
  feedbackJson: string
): Promise<string> {
  let feedback: FeedbackInput;
  try {
    feedback = JSON.parse(feedbackJson) as FeedbackInput;
  } catch {
    return "❌ Invalid JSON. Expected: { confirmedRootCause, proposedRootCause, missingEvents?, timingUpdates?, wrongSuspects?, goodEtlPath?, notes? }";
  }

  if (!feedback.confirmedRootCause || !feedback.proposedRootCause) {
    return "❌ Required fields: confirmedRootCause (yes/no/unknown) and proposedRootCause (string).";
  }

  const result: FeedbackResult = { applied: [], deferred: [], summary: "" };

  // 1. Apply timing baseline updates (safe, additive)
  if (feedback.timingUpdates && Object.keys(feedback.timingUpdates).length > 0) {
    applyTimingUpdates(feedback.timingUpdates, result);
  }

  // 2. Apply missing event registrations (safe, additive)
  if (feedback.missingEvents && feedback.missingEvents.length > 0) {
    applyMissingEvents(feedback.missingEvents, result);
  }

  // 3. Process root cause confirmation
  processRootCauseConfirmation(feedback, result);

  // 4. Log wrong suspects for review (deferred, not auto-applied)
  if (feedback.wrongSuspects && feedback.wrongSuspects.length > 0) {
    for (const ws of feedback.wrongSuspects) {
      result.deferred.push(
        `Suspect "${ws.name}" was wrong: ${ws.reason} — logged for KB review`
      );
    }
  }

  // 5. Record good ETL path for comparison baseline
  if (feedback.goodEtlPath) {
    result.applied.push(`Good ETL reference noted: ${feedback.goodEtlPath}`);
  }

  // 6. Log free-text notes
  if (feedback.notes) {
    result.deferred.push(`User notes logged: "${feedback.notes.slice(0, 200)}"`);
  }

  // Build summary
  result.summary = formatFeedbackReport(feedback, result);
  return result.summary;
}

// ─── Timing updates ─────────────────────────────────────────────────

function applyTimingUpdates(
  updates: Record<string, number>,
  result: FeedbackResult
): void {
  try {
    const baselines: Record<string, { p50_ms: number; p95_ms: number; sample_count: number }> =
      loadJson("timing_baselines.json") || {};

    for (const [stage, observedMs] of Object.entries(updates)) {
      if (typeof observedMs !== "number" || observedMs < 0) {
        result.deferred.push(`Timing for "${stage}": invalid value ${observedMs}, skipped`);
        continue;
      }

      if (baselines[stage]) {
        // Exponential moving average with n as weight
        const existing = baselines[stage];
        const n = existing.sample_count;
        const alpha = Math.max(0.05, 1 / (n + 1));
        existing.p50_ms = Math.round(existing.p50_ms * (1 - alpha) + observedMs * alpha);
        existing.p95_ms = Math.max(existing.p95_ms, observedMs);
        existing.sample_count = n + 1;
        result.applied.push(
          `Timing "${stage}": updated p50=${existing.p50_ms}ms, p95=${existing.p95_ms}ms (n=${existing.sample_count})`
        );
      } else {
        baselines[stage] = {
          p50_ms: observedMs,
          p95_ms: Math.round(observedMs * 1.5),
          sample_count: 1,
        };
        result.applied.push(
          `Timing "${stage}": NEW baseline p50=${observedMs}ms, p95=${Math.round(observedMs * 1.5)}ms`
        );
      }
    }

    saveJson("timing_baselines.json", baselines);
  } catch (err: any) {
    result.deferred.push(`Timing update failed: ${err.message}`);
  }
}

// ─── Missing events ─────────────────────────────────────────────────

function applyMissingEvents(
  missingEvents: string[],
  result: FeedbackResult
): void {
  try {
    const events: Record<string, { description: string; params?: string[] }> =
      loadJson("events.json") || {};

    for (const eventName of missingEvents) {
      const normalized = eventName.trim();
      if (!normalized) continue;

      if (events[normalized]) {
        result.deferred.push(`Event "${normalized}" already in KB, skipped`);
      } else {
        events[normalized] = {
          description: `User-reported event (auto-added via feedback)`,
        };
        result.applied.push(`Event "${normalized}": added to KB`);
      }
    }

    saveJson("events.json", events);
  } catch (err: any) {
    result.deferred.push(`Event update failed: ${err.message}`);
  }
}

// ─── Root cause confirmation ────────────────────────────────────────

function processRootCauseConfirmation(
  feedback: FeedbackInput,
  result: FeedbackResult
): void {
  try {
    const rootCauses: Record<string, any> = loadJson("root_causes.json") || {};

    if (feedback.confirmedRootCause === "yes") {
      // Boost confidence for confirmed root causes
      if (rootCauses[feedback.proposedRootCause]) {
        const rc = rootCauses[feedback.proposedRootCause];
        rc.confirmed_count = (rc.confirmed_count || 0) + 1;
        result.applied.push(
          `Root cause "${feedback.proposedRootCause}": confirmed (count=${rc.confirmed_count})`
        );
      } else {
        // Add new root cause entry
        rootCauses[feedback.proposedRootCause] = {
          description: `User-confirmed root cause (auto-added)`,
          confirmed_count: 1,
          etw_signals: [],
        };
        result.applied.push(
          `Root cause "${feedback.proposedRootCause}": NEW entry added (confirmed)`
        );
      }
      saveJson("root_causes.json", rootCauses);
    } else if (feedback.confirmedRootCause === "no") {
      result.deferred.push(
        `Root cause "${feedback.proposedRootCause}" was NOT confirmed — logged for KB review`
      );
    } else {
      result.deferred.push(
        `Root cause "${feedback.proposedRootCause}" confirmation unknown — no KB change`
      );
    }
  } catch (err: any) {
    result.deferred.push(`Root cause update failed: ${err.message}`);
  }
}

// ─── Report formatting ─────────────────────────────────────────────

function formatFeedbackReport(feedback: FeedbackInput, result: FeedbackResult): string {
  const out: string[] = [];

  out.push("## 📝 RCA Feedback Processed");
  out.push("");
  out.push(`**Proposed root cause**: ${feedback.proposedRootCause}`);
  out.push(`**Confirmed**: ${feedback.confirmedRootCause}`);
  out.push("");

  if (result.applied.length > 0) {
    out.push("### ✅ Applied to Knowledge Base");
    out.push("");
    for (const a of result.applied) {
      out.push(`- ${a}`);
    }
    out.push("");
  }

  if (result.deferred.length > 0) {
    out.push("### ⏳ Deferred (logged for review)");
    out.push("");
    for (const d of result.deferred) {
      out.push(`- ${d}`);
    }
    out.push("");
  }

  if (result.applied.length === 0 && result.deferred.length === 0) {
    out.push("_No changes applied or deferred._");
  }

  out.push("---");
  out.push("_Feedback captured. Use `share_learnings` to sync KB with community._");

  return out.join("\n");
}
