/**
 * GitHub-synced knowledge base.
 *
 * On startup: pulls latest knowledge JSONs from the GitHub repo.
 * After learning: pushes updated JSONs back so all users benefit.
 *
 * Requires GITHUB_TOKEN env var (PAT with repo scope, or fine-grained with contents:write).
 * Falls back to local-only mode if no token is set.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_OWNER = "krbharadwaj";
const REPO_NAME = "webview2-etw-mcp-server";
const BRANCH = "main";
const KNOWLEDGE_FILES = [
  "api_ids.json",
  "events.json",
  "root_causes.json",
  "timing_baselines.json",
  "api_sequences.json",
];

let syncEnabled = false;
let githubToken: string | null = null;
let lastSyncTime = 0;
const SYNC_COOLDOWN_MS = 60_000; // Don't sync more than once per minute

/**
 * Initialize sync — call once on server startup.
 * Returns true if GitHub sync is available.
 */
export function initSync(): boolean {
  githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  syncEnabled = !!githubToken;

  if (!syncEnabled) {
    console.error(
      "[sync] No GITHUB_TOKEN set — running in local-only mode. " +
      "Set GITHUB_TOKEN env var to enable shared learning."
    );
  } else {
    console.error("[sync] GitHub sync enabled — learnings will be shared.");
  }

  return syncEnabled;
}

/**
 * Pull latest knowledge from GitHub.
 * Merges remote data with local data (additive merge — never loses local entries).
 */
export async function pullLatest(knowledgeDir: string): Promise<string> {
  if (!syncEnabled || !githubToken) return "";

  const now = Date.now();
  if (now - lastSyncTime < SYNC_COOLDOWN_MS) return "";

  const results: string[] = [];

  for (const file of KNOWLEDGE_FILES) {
    try {
      const remoteData = await fetchFileFromGitHub(
        `src/knowledge/${file}`
      );
      if (!remoteData) continue;

      const localPath = join(knowledgeDir, file);
      if (!existsSync(localPath)) {
        // No local file — write remote directly
        writeFileSync(localPath, JSON.stringify(remoteData, null, 2) + "\n", "utf-8");
        results.push(`📥 Downloaded ${file}`);
        continue;
      }

      const localData = JSON.parse(readFileSync(localPath, "utf-8"));
      const merged = additiveMerge(localData, remoteData, file);

      if (merged.changes > 0) {
        writeFileSync(localPath, JSON.stringify(merged.data, null, 2) + "\n", "utf-8");
        results.push(`📥 Merged ${file}: +${merged.changes} entries from remote`);
      }
    } catch (err: any) {
      console.error(`[sync] Failed to pull ${file}: ${err.message}`);
    }
  }

  lastSyncTime = now;
  if (results.length === 0) return "";
  return "\n🔄 **Synced with GitHub**: " + results.join(" | ");
}

/**
 * Push local knowledge updates back to GitHub.
 * Only pushes files that have changed since last sync.
 */
export async function pushLearnings(knowledgeDir: string): Promise<string> {
  if (!syncEnabled || !githubToken) return "";

  const results: string[] = [];

  for (const file of KNOWLEDGE_FILES) {
    try {
      const localPath = join(knowledgeDir, file);
      if (!existsSync(localPath)) continue;

      const localContent = readFileSync(localPath, "utf-8");
      const localData = JSON.parse(localContent);

      // Get current SHA from GitHub (needed for update API)
      const remoteMeta = await getFileSha(`src/knowledge/${file}`);

      // Compare — only push if local has more entries
      if (remoteMeta) {
        const remoteData = await fetchFileFromGitHub(`src/knowledge/${file}`);
        if (remoteData) {
          const localCount = Object.keys(localData).filter(k => !k.startsWith("_")).length;
          const remoteCount = Object.keys(remoteData).filter(k => !k.startsWith("_")).length;
          if (localCount <= remoteCount) continue; // Remote is same or bigger — skip
        }
      }

      // Push to GitHub
      const content = Buffer.from(
        JSON.stringify(localData, null, 2) + "\n"
      ).toString("base64");

      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/src/knowledge/${file}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "Content-Type": "application/json",
            "User-Agent": "webview2-etw-mcp-server",
          },
          body: JSON.stringify({
            message: `🧠 Auto-learned: update ${file}`,
            content,
            sha: remoteMeta?.sha,
            branch: BRANCH,
          }),
        }
      );

      if (response.ok) {
        results.push(`📤 Pushed ${file}`);
      } else {
        const errText = await response.text();
        console.error(`[sync] Push ${file} failed (${response.status}): ${errText}`);
      }
    } catch (err: any) {
      console.error(`[sync] Failed to push ${file}: ${err.message}`);
    }
  }

  if (results.length === 0) return "";
  return "\n📤 **Shared to GitHub**: " + results.join(" | ");
}

/**
 * Get sync status for display.
 */
export function getSyncStatus(): string {
  if (!syncEnabled) {
    return "🔴 Local-only mode (set GITHUB_TOKEN to enable shared learning)";
  }
  return "🟢 GitHub sync enabled — learnings are shared with all users";
}

// ─── Internal helpers ───────────────────────────────────────────────

async function fetchFileFromGitHub(path: string): Promise<any | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3.raw",
          "User-Agent": "webview2-etw-mcp-server",
        },
      }
    );
    if (!response.ok) return null;
    const text = await response.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getFileSha(path: string): Promise<{ sha: string } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "webview2-etw-mcp-server",
        },
      }
    );
    if (!response.ok) return null;
    const data = await response.json() as any;
    return { sha: data.sha };
  } catch {
    return null;
  }
}

/**
 * Additive merge: combines local + remote, never losing entries.
 * For JSON objects: adds keys from remote that local doesn't have.
 * For arrays: union.
 */
function additiveMerge(
  local: any,
  remote: any,
  filename: string
): { data: any; changes: number } {
  let changes = 0;

  if (typeof local !== "object" || typeof remote !== "object") {
    return { data: local, changes: 0 };
  }

  // Both are objects — merge keys
  const merged = { ...local };
  for (const key of Object.keys(remote)) {
    if (key.startsWith("_")) continue; // Skip metadata keys

    if (!(key in merged)) {
      // New entry from remote — add it
      merged[key] = remote[key];
      changes++;
    } else if (filename === "timing_baselines.json" && merged[key].sampleCount !== undefined) {
      // For timings: pick the one with more samples
      if (remote[key].sampleCount > merged[key].sampleCount) {
        merged[key] = remote[key];
        changes++;
      }
    }
    // For events/api_ids/root_causes: local wins (user may have edited)
  }

  return { data: merged, changes };
}
