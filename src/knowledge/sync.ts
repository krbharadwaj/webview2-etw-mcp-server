/**
 * GitHub-synced knowledge base.
 *
 * On startup: pulls latest knowledge JSONs from the GitHub repo (public — no auth needed).
 * After learning: pushes updates via GitHub Issues (auto-processed by GitHub Actions).
 *
 * Token detection priority (all automatic — zero manual setup for most users):
 *   1. GITHUB_TOKEN / GH_TOKEN env var (explicit)
 *   2. gh CLI token (if gh is installed and authenticated)
 *   3. VS Code GitHub token (from OS credential store)
 *   4. No token — read-only mode (pull works, sharing requires auth)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

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
let tokenSource: string = "none";
let lastSyncTime = 0;
const SYNC_COOLDOWN_MS = 60_000; // Don't sync more than once per minute

/**
 * Initialize sync — call once on server startup.
 * Attempts to auto-detect GitHub auth from multiple sources.
 * Returns true if sync is available (always true — reads work without auth).
 */
export function initSync(): boolean {
  // Priority: explicit env var > gh CLI > VS Code credential store
  githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

  if (githubToken) {
    tokenSource = "env";
    console.error("[sync] Using GITHUB_TOKEN from environment.");
  } else {
    // Try auto-detection
    githubToken = detectGhCliToken();
    if (githubToken) {
      tokenSource = "gh-cli";
    } else {
      githubToken = detectVSCodeToken();
      if (githubToken) {
        tokenSource = "vscode";
      }
    }
  }

  // Sync is always enabled — public repo reads work without auth
  syncEnabled = true;

  if (!githubToken) {
    tokenSource = "none";
    console.error(
      "[sync] No GitHub auth detected — pull-only mode.\n" +
      "       To enable sharing, do ONE of:\n" +
      "       • Install gh CLI and run: gh auth login\n" +
      "       • Sign into GitHub in VS Code\n" +
      "       • Set GITHUB_TOKEN env var"
    );
  } else {
    console.error(`[sync] GitHub auth detected (source: ${tokenSource}) — sharing enabled.`);
  }

  return syncEnabled;
}

/**
 * Detect GitHub token from the gh CLI (if installed and authenticated).
 */
function detectGhCliToken(): string | null {
  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token && token.length > 10) {
      console.error("[sync] Auto-detected gh CLI token.");
      return token;
    }
  } catch {
    // gh CLI not installed or not authenticated — silent fallback
  }
  return null;
}

/**
 * Detect GitHub token from VS Code's credential store.
 * VS Code stores GitHub OAuth tokens in the OS credential manager
 * when users sign in for Copilot, Settings Sync, GitHub PRs, etc.
 */
function detectVSCodeToken(): string | null {
  if (process.platform === "win32") {
    return detectVSCodeTokenWindows();
  } else if (process.platform === "darwin") {
    return detectVSCodeTokenMacOS();
  } else {
    return detectVSCodeTokenLinux();
  }
}

function detectVSCodeTokenWindows(): string | null {
  try {
    // VS Code stores GitHub tokens in Windows Credential Manager
    // via the PasswordVault API under 'vscode/vscode.github-authentication'
    const psScript = [
      "[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]",
      "$vault = New-Object Windows.Security.Credentials.PasswordVault",
      "try {",
      "  $creds = $vault.FindAllByResource('vscode/vscode.github-authentication')",
      "  if ($creds.Count -gt 0) {",
      "    $creds[0].RetrievePassword()",
      "    Write-Output $creds[0].Password",
      "  }",
      "} catch { }",
    ].join("\n");

    const raw = execSync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (raw) {
      return extractTokenFromVSCodeCredential(raw);
    }
  } catch {
    // PasswordVault not available or no VS Code credentials
  }
  return null;
}

function detectVSCodeTokenMacOS(): string | null {
  try {
    // macOS: VS Code uses Keychain
    const raw = execSync(
      `security find-generic-password -s "vscode.github-authentication" -w 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (raw) {
      return extractTokenFromVSCodeCredential(raw);
    }
  } catch {
    // Keychain entry not found
  }
  return null;
}

function detectVSCodeTokenLinux(): string | null {
  try {
    // Linux: VS Code uses libsecret / gnome-keyring
    const raw = execSync(
      `secret-tool lookup service "vscode.github-authentication" 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (raw) {
      return extractTokenFromVSCodeCredential(raw);
    }
  } catch {
    // secret-tool not available or no entry
  }
  return null;
}

/**
 * VS Code stores credentials as a JSON array:
 *   [{"accessToken":"gho_xxx","account":{"label":"user","id":"123"}}]
 * Extract the accessToken from it.
 */
function extractTokenFromVSCodeCredential(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      const token = entry?.accessToken;
      if (typeof token === "string" && token.length > 10) {
        console.error("[sync] Auto-detected VS Code GitHub token.");
        return token;
      }
    }
  } catch {
    // Not JSON — might be a raw token string
    if (typeof raw === "string" && raw.length > 10 && !raw.includes(" ")) {
      console.error("[sync] Auto-detected VS Code GitHub token (raw).");
      return raw;
    }
  }
  return null;
}

/**
 * Pull latest knowledge from GitHub.
 * Merges remote data with local data (additive merge — never loses local entries).
 */
export async function pullLatest(knowledgeDir: string): Promise<string> {
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
  if (!githubToken) return "";
  // Use direct push for users with repo write access (env token)
  if (tokenSource === "env") {
    return pushLearningsDirect(knowledgeDir);
  }
  return "";
}

/**
 * Direct push for users with explicit GITHUB_TOKEN (repo write access).
 */
async function pushLearningsDirect(knowledgeDir: string): Promise<string> {

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
  if (!githubToken) {
    return (
      "🟡 Pull-only mode — receiving shared learnings but cannot share.\n\n" +
      "To enable sharing, do ONE of:\n" +
      "• Install `gh` CLI and run: `gh auth login`\n" +
      "• Sign into GitHub in VS Code (for Copilot, Settings Sync, etc.)\n" +
      "• Set `GITHUB_TOKEN` env var in your MCP config"
    );
  }
  if (tokenSource === "env") {
    return "🟢 GitHub sync enabled (direct push) — learnings are shared with all users";
  }
  return `🟢 GitHub sync enabled (via Issues, auth: ${tokenSource}) — learnings are shared with all users`;
}

// ─── Share Learnings (preview + confirm) ──────────────────────────

export interface LearningDiff {
  file: string;
  newEntries: { key: string; summary: string }[];
  updatedEntries: { key: string; summary: string }[];
}

/**
 * Preview what would be shared — computes diff of local vs remote
 * without pushing anything. Returns a human-readable diff.
 */
export async function previewLearnings(knowledgeDir: string): Promise<{
  diffs: LearningDiff[];
  summary: string;
}> {
  // Preview works for everyone — reads are unauthenticated on public repo

  const diffs: LearningDiff[] = [];
  let totalNew = 0;
  let totalUpdated = 0;

  for (const file of KNOWLEDGE_FILES) {
    try {
      const localPath = join(knowledgeDir, file);
      if (!existsSync(localPath)) continue;

      const localData = JSON.parse(readFileSync(localPath, "utf-8"));
      const remoteData = await fetchFileFromGitHub(`src/knowledge/${file}`);

      const diff: LearningDiff = { file, newEntries: [], updatedEntries: [] };

      if (!remoteData) {
        // Entire file is new
        for (const key of Object.keys(localData).filter(k => !k.startsWith("_"))) {
          diff.newEntries.push({ key, summary: summarizeEntry(file, key, localData[key]) });
        }
      } else {
        for (const key of Object.keys(localData).filter(k => !k.startsWith("_"))) {
          if (!(key in remoteData)) {
            diff.newEntries.push({ key, summary: summarizeEntry(file, key, localData[key]) });
          } else if (file === "timing_baselines.json" &&
                     localData[key].sampleCount > remoteData[key].sampleCount) {
            diff.updatedEntries.push({
              key,
              summary: `samples: ${remoteData[key].sampleCount} → ${localData[key].sampleCount}`,
            });
          } else if (file === "api_sequences.json" && key !== "_metadata") {
            const localSteps = localData[key]?.steps?.length || 0;
            const remoteSteps = remoteData[key]?.steps?.length || 0;
            if (localSteps > remoteSteps) {
              diff.updatedEntries.push({
                key,
                summary: `steps: ${remoteSteps} → ${localSteps}`,
              });
            }
          }
        }
      }

      if (diff.newEntries.length > 0 || diff.updatedEntries.length > 0) {
        diffs.push(diff);
        totalNew += diff.newEntries.length;
        totalUpdated += diff.updatedEntries.length;
      }
    } catch (err: any) {
      console.error(`[sync] Preview failed for ${file}: ${err.message}`);
    }
  }

  if (diffs.length === 0) {
    return {
      diffs: [],
      summary: "✅ **Nothing new to share** — your local knowledge matches the shared repo.",
    };
  }

  // Build human-readable diff
  const lines: string[] = [
    `## 📤 Learnings Ready to Share`,
    ``,
    `**${totalNew} new** entries and **${totalUpdated} updated** entries across ${diffs.length} knowledge file(s).`,
    ``,
  ];

  for (const diff of diffs) {
    const label = file_labels[diff.file] || diff.file;
    lines.push(`### ${label} (\`${diff.file}\`)`);
    if (diff.newEntries.length > 0) {
      lines.push(`**New (${diff.newEntries.length}):**`);
      for (const e of diff.newEntries.slice(0, 15)) {
        lines.push(`  - \`${e.key}\` — ${e.summary}`);
      }
      if (diff.newEntries.length > 15) {
        lines.push(`  - ... and ${diff.newEntries.length - 15} more`);
      }
    }
    if (diff.updatedEntries.length > 0) {
      lines.push(`**Updated (${diff.updatedEntries.length}):**`);
      for (const e of diff.updatedEntries.slice(0, 10)) {
        lines.push(`  - \`${e.key}\` — ${e.summary}`);
      }
      if (diff.updatedEntries.length > 10) {
        lines.push(`  - ... and ${diff.updatedEntries.length - 10} more`);
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`To push these learnings, run **share_learnings** again with \`action: "confirm"\`.`);

  return { diffs, summary: lines.join("\n") };
}

/**
 * Confirm and push learnings after preview.
 * Only pushes files that have actual diffs (re-checks before pushing).
 */
export async function confirmAndPush(knowledgeDir: string): Promise<string> {
  if (!githubToken) {
    return (
      "🔴 **Cannot share**: No GitHub authentication detected.\n\n" +
      "To enable sharing, do ONE of:\n" +
      "• Install `gh` CLI and run: `gh auth login`\n" +
      "• Sign into GitHub in VS Code (for Copilot, Settings Sync, etc.)\n" +
      "• Set `GITHUB_TOKEN` env var in your MCP config"
    );
  }

  // Users with explicit env token (repo write access) → direct push
  if (tokenSource === "env") {
    return confirmAndPushDirect(knowledgeDir);
  }

  // Users with auto-detected token (gh CLI / VS Code) → push via GitHub Issue
  return confirmAndPushViaIssue(knowledgeDir);
}

/**
 * Direct push for users with repo write access (existing behavior).
 */
async function confirmAndPushDirect(knowledgeDir: string): Promise<string> {

  // Re-compute diffs to ensure we only push what's actually new
  const { diffs } = await previewLearnings(knowledgeDir);
  if (diffs.length === 0) {
    return "✅ Nothing new to share — local knowledge matches the shared repo.";
  }

  const results: string[] = [];
  const filesToPush = new Set(diffs.map(d => d.file));

  for (const file of filesToPush) {
    try {
      const localPath = join(knowledgeDir, file);
      if (!existsSync(localPath)) continue;

      const localData = JSON.parse(readFileSync(localPath, "utf-8"));

      // Merge with remote first (in case someone else pushed meanwhile)
      const remoteData = await fetchFileFromGitHub(`src/knowledge/${file}`);
      let merged = localData;
      if (remoteData) {
        const mergeResult = additiveMerge(localData, remoteData, file);
        merged = mergeResult.data;
      }

      const remoteMeta = await getFileSha(`src/knowledge/${file}`);
      const content = Buffer.from(
        JSON.stringify(merged, null, 2) + "\n"
      ).toString("base64");

      const diff = diffs.find(d => d.file === file)!;
      const commitMsg = `🧠 Shared: +${diff.newEntries.length} new, ${diff.updatedEntries.length} updated in ${file}`;

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
            message: commitMsg,
            content,
            sha: remoteMeta?.sha,
            branch: BRANCH,
          }),
        }
      );

      if (response.ok) {
        results.push(`✅ ${file}: +${diff.newEntries.length} new, ${diff.updatedEntries.length} updated`);
      } else {
        const errText = await response.text();
        results.push(`❌ ${file}: push failed (${response.status})`);
        console.error(`[sync] Push ${file} failed: ${errText}`);
      }
    } catch (err: any) {
      results.push(`❌ ${file}: ${err.message}`);
    }
  }

  return `## 📤 Share Results\n\n${results.join("\n")}\n\nAll users will receive these learnings when they next start their server.`;
}

/**
 * Push learnings by creating a GitHub Issue.
 * A GitHub Actions workflow automatically processes the issue, merges the
 * knowledge, and commits. This only requires issues:write scope — no repo
 * write access needed.
 */
async function confirmAndPushViaIssue(knowledgeDir: string): Promise<string> {
  const { diffs } = await previewLearnings(knowledgeDir);
  if (diffs.length === 0) {
    return "✅ Nothing new to share — local knowledge matches the shared repo.";
  }

  // Build payload: only include files that have diffs
  const files: Record<string, any> = {};
  for (const diff of diffs) {
    const localPath = join(knowledgeDir, diff.file);
    if (!existsSync(localPath)) continue;
    files[diff.file] = JSON.parse(readFileSync(localPath, "utf-8"));
  }

  const totalNew = diffs.reduce((s, d) => s + d.newEntries.length, 0);
  const totalUpdated = diffs.reduce((s, d) => s + d.updatedEntries.length, 0);

  // Build a human-readable summary for the issue body
  const summaryLines: string[] = [
    `Automated knowledge submission from MCP server (auth: ${tokenSource}).`,
    ``,
    `**Files:** ${Object.keys(files).join(", ")}`,
    `**New entries:** ${totalNew} | **Updated entries:** ${totalUpdated}`,
    ``,
  ];

  for (const diff of diffs) {
    const label = file_labels[diff.file] || diff.file;
    summaryLines.push(`### ${label}`);
    if (diff.newEntries.length > 0) {
      summaryLines.push(`New: ${diff.newEntries.map(e => `\`${e.key}\``).slice(0, 10).join(", ")}${diff.newEntries.length > 10 ? ` (+${diff.newEntries.length - 10} more)` : ""}`);
    }
    if (diff.updatedEntries.length > 0) {
      summaryLines.push(`Updated: ${diff.updatedEntries.map(e => `\`${e.key}\``).slice(0, 10).join(", ")}`);
    }
    summaryLines.push(``);
  }

  summaryLines.push(`---`);
  summaryLines.push(`<details><summary>Full payload (processed by GitHub Actions)</summary>\n`);
  summaryLines.push("```json");
  summaryLines.push(JSON.stringify({ files }, null, 2));
  summaryLines.push("```");
  summaryLines.push(`\n</details>`);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
          "User-Agent": "webview2-etw-mcp-server",
        },
        body: JSON.stringify({
          title: `🧠 Learning Submission: +${totalNew} new, ${totalUpdated} updated`,
          body: summaryLines.join("\n"),
          labels: ["learning-submission"],
        }),
      }
    );

    if (response.ok) {
      const issue = (await response.json()) as any;
      return (
        `## 📤 Submitted!\n\n` +
        `Created issue [#${issue.number}](${issue.html_url}) — GitHub Actions will process and merge automatically.\n\n` +
        `Track progress: ${issue.html_url}\n\n` +
        `All users will receive these learnings on their next server startup.`
      );
    } else {
      const status = response.status;
      const errText = await response.text();
      console.error(`[sync] Issue creation failed (${status}): ${errText}`);

      if (status === 403 || status === 401) {
        return (
          `❌ **Share failed**: Your GitHub token doesn't have permission to create issues.\n\n` +
          `This can happen if your token has limited scopes. To fix:\n` +
          `• **gh CLI**: Run \`gh auth login -s public_repo\` to refresh with the right scope\n` +
          `• **VS Code**: Sign out and back into GitHub in VS Code\n` +
          `• **Manual**: Set \`GITHUB_TOKEN\` env var with a token that has \`public_repo\` scope`
        );
      }
      return `❌ Share failed (${status}): ${errText}`;
    }
  } catch (err: any) {
    return `❌ Failed to create GitHub issue: ${err.message}`;
  }
}

const file_labels: Record<string, string> = {
  "events.json": "📋 Events",
  "api_ids.json": "🔢 API IDs",
  "root_causes.json": "🔍 Root Causes",
  "timing_baselines.json": "⏱️ Timing Baselines",
  "api_sequences.json": "🔗 API Sequences",
};

function summarizeEntry(file: string, key: string, value: any): string {
  if (file === "events.json") {
    return value.description || value.category || "event";
  } else if (file === "api_ids.json") {
    return value.name || value.category || "API";
  } else if (file === "root_causes.json") {
    return value.symptom || value.classification || "root cause";
  } else if (file === "timing_baselines.json") {
    return `avg ${value.avgMs?.toFixed(0) || "?"}ms (${value.sampleCount || 1} samples)`;
  } else if (file === "api_sequences.json") {
    return `${value.steps?.length || 0} steps, confidence ${value.confidence || "?"}`;
  }
  return JSON.stringify(value).slice(0, 60);
}

// ─── Internal helpers ───────────────────────────────────────────────

async function fetchFileFromGitHub(path: string): Promise<any | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "webview2-etw-mcp-server",
    };
    // Use token if available (higher rate limit: 5000/hr vs 60/hr)
    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
      { headers }
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
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "webview2-etw-mcp-server",
    };
    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${BRANCH}`,
      { headers }
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
