# ⭐ WebView2 ETW Analysis MCP Server

Analyze WebView2 ETL traces with AI. **14 tools** in a clear step-by-step workflow: extract → triage → playbook → evidence → feedback → share.

---

## ✨ One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

Click the button above → VS Code opens → MCP server is configured. **That's it.**

---

## 📄 Table of Contents

1. [📺 Overview](#-overview)
2. [🎯 Step-by-Step Workflow](#-step-by-step-workflow)
3. [⚙️ All 14 Tools](#️-all-14-tools)
4. [🔌 Installation](#-installation)
5. [🎩 Usage Examples](#-usage-examples)
6. [📚 Knowledge Base](#-knowledge-base)
7. [🧠 How Auto-Learning Works](#-how-auto-learning-works)
8. [📤 Sharing Learnings](#-sharing-learnings)
9. [🏗️ Architecture](#️-architecture)
10. [📌 Contributing](#-contributing)

---

## 📺 Overview

The WebView2 ETW MCP Server brings WebView2 ETL trace analysis directly into GitHub Copilot Chat. Just talk in plain English:

- *"What is API ID 33?"* → `AddNavigationStarting` (category, critical flag, related events)
- *"Analyze C:\traces\stuck.etl for Teams"* → PowerShell extraction commands + feature flag extraction
- *"Triage this trace — NavigationCompleted not received"* → Fast Triage Card with top 3 root causes + confidence + evidence pointers
- *"Run the navigation playbook"* → Deterministic lifecycle pipeline check — shows exactly where navigation breaks
- *"Build evidence pack for navigation_stalled"* → Structured RCA: hypothesis, evidence, counter-evidence, timeline, confidence
- *"My WebView2 app is stuck"* → decision tree + known root causes + investigation commands
- *"What happened between timestamps X and Y?"* → event breakdown by category, errors, silent gaps
- *"Compare good.etl vs bad.etl for Outlook"* → side-by-side diff of events, timings, errors
- *"Validate this trace against known happy paths"* → API sequence validation + health report
- *"What was PID 27528 doing on CPU?"* → CPU profiling with Chromium + Edge + Microsoft symbol servers
- *"Share my learnings"* → preview diff of new knowledge, confirm to push to GitHub for all users

---

## 🎯 Step-by-Step Workflow

**Follow this order. CPU profiling is NOT part of initial analysis — it's deferred.**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: EXTRACT                                                    │
│  "Analyze C:\traces\stuck.etl for Teams"                           │
│  → analyze_etl: PowerShell commands to extract & filter            │
│  → Run the commands → get filtered.txt                             │
├─────────────────────────────────────────────────────────────────────┤
│  Step 2: TRIAGE (first thing on filtered data)                     │
│  "Triage this trace — NavigationCompleted not received"            │
│  → triage: Triage Card with top 3 root causes + confidence        │
│  → Evidence pointers + missing signals + next actions              │
├─────────────────────────────────────────────────────────────────────┤
│  Step 3: PLAYBOOK (if navigation issue)                            │
│  "Run the navigation playbook"                                     │
│  → nav_playbook: ✅ Navigate → ✅ Starting → ❌ Completed          │
│  → Host ↔ Runtime boundary checks                                  │
│  → Exact stage where pipeline breaks                               │
├─────────────────────────────────────────────────────────────────────┤
│  Step 4: EVIDENCE (build RCA narrative)                            │
│  "Build evidence pack for navigation_stalled"                      │
│  → evidence_pack: hypothesis + evidence + counter-evidence         │
│  → Timeline + confidence scoring + alternatives                    │
├─────────────────────────────────────────────────────────────────────┤
│  Step 5: FEEDBACK (close the loop)                                 │
│  "Confirm root cause: yes, navigation_stalled"                     │
│  → rca_feedback: KB updated (timings, events, root cause)          │
├─────────────────────────────────────────────────────────────────────┤
│  Step 6: SHARE                                                     │
│  "Share my learnings"                                              │
│  → share_learnings: preview diff → confirm → pushed to GitHub      │
└─────────────────────────────────────────────────────────────────────┘

  Optional deep dives (only when needed):
  ┌──────────────────────────────────────────┐
  │  timeline_slice — zoom into a time range │
  │  compare_etls — diff good vs bad ETL     │
  │  validate_trace — check API sequences    │
  │  analyze_cpu — ⏳ ONLY if CPU suspected  │
  └──────────────────────────────────────────┘
```

---

## ⚙️ All 14 Tools

### 🎯 Core Workflow (Steps 1–6)

| Step | Tool | What It Does |
|------|------|-------------|
| 1️⃣ Extract | `analyze_etl` | Generate PowerShell commands to extract and filter ETL traces. Process discovery, WebView2 event filtering, feature flags, timeline building. |
| 2️⃣ Triage | `triage` | **Start here after extraction.** Fast root-cause scoring → Triage Card with top 3 suspects, confidence, evidence pointers, missing signals. |
| 3️⃣ Playbook | `nav_playbook` | Deterministic navigation lifecycle check. Checks each stage (Navigate→Completed), correlates by NavigationId, detects host-vs-runtime boundary issues, IFrame removal, NoHandlers. |
| 4️⃣ Evidence | `evidence_pack` | Structured RCA-ready pack: hypothesis, evidence table, timeline, counter-evidence, confidence scoring, timing anomalies. |
| 5️⃣ Feedback | `rca_feedback` | Capture structured feedback → guarded KB updates. Confirmed root cause? Missing events? Timing baselines? All safe updates auto-applied. |
| 6️⃣ Share | `share_learnings` | Preview what you've learned locally → confirm → pushed to GitHub for all users. |

### 🔍 Deep-Dive Tools (use when needed)

| Tool | When to Use |
|------|------------|
| `timeline_slice` | Zoom into a specific time window — events by category, processes, errors, silent gaps. |
| `compare_etls` | Diff two ETL traces (good vs bad) — missing events, timing gaps, failure-only errors. |
| `validate_trace` | Check trace against known API happy-path sequences. `learn_good`/`learn_bad` modes mine new patterns. |
| `analyze_cpu` | ⏳ **Deferred** — only when triage/evidence suggests CPU contention. Uses Chromium + Edge + MS symbol servers. |

### 📖 Lookup Tools (anytime)

| Tool | What It Does |
|------|-------------|
| `decode_api_id` | Decode WebView2 API ID numbers (0-174) → names, categories. Batch mode supported. |
| `lookup_event` | Look up any of 189+ ETW events by name (partial match) → description, params, severity. |
| `diagnose` | Decision trees for 7 symptoms (stuck, crash, slow_init, etc.) — works without a trace file. |
| `sync_status` | Check GitHub sync status — is sharing active? |

See **[TOOLS_GUIDE.md](TOOLS_GUIDE.md)** for the complete reference with human-language examples.

---

## 🔌 Installation

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Windows** — ETL analysis uses PowerShell + xperf
- **Windows Performance Toolkit** — [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/)

### ✨ One-Click Install (Recommended)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

### 📋 Manual Install

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "webview2-etw": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:krbharadwaj/webview2-etw-mcp-server"]
    }
  }
}
```

Or add to your VS Code user `settings.json` (global — applies to all workspaces):

```json
{
  "mcp": {
    "servers": {
      "webview2-etw": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "github:krbharadwaj/webview2-etw-mcp-server"]
      }
    }
  }
}
```

> **No `GITHUB_TOKEN` needed!** The server auto-detects your GitHub authentication from `gh` CLI or VS Code. See [Sharing Learnings](#-sharing-learnings) for details.

### 🔧 From Source (for development)

```bash
git clone https://github.com/krbharadwaj/webview2-etw-mcp-server.git
cd webview2-etw-mcp-server
npm install && npm run build
```

Then point to the local build:

```json
{
  "servers": {
    "webview2-etw": {
      "type": "stdio",
      "command": "node",
      "args": ["<path>/webview2-etw-mcp-server/dist/index.js"]
    }
  }
}
```

---

## 🎩 Usage Examples

Switch to **Agent Mode** in GitHub Copilot Chat, then just ask:

### Step-by-Step Example (Recommended Flow)

```
Step 1 — EXTRACT:
You: "I have an ETL at C:\traces\teams_stuck.etl. Teams is stuck."
  → analyze_etl: PowerShell extraction commands
  → Run them → get C:\temp\etl_analysis\filtered_webview2.txt

Step 2 — TRIAGE:
You: "Triage this trace — NavigationCompleted not received"
  → Triage Card:
     🔴 #1 navigation_stalled (0.85) — Navigate called, no Completed
     🟡 #2 initializing_navigation_suppression (0.62) — DocStateSuppressed found
     Missing: WebView2_NavigationCompleted, WebView2_Event_NavigationCompletedHandler

Step 3 — PLAYBOOK:
You: "Run the navigation playbook"
  → ✅ Navigate API → ✅ NavigationStarting → ✅ SourceChanged → ❌ NavigationCompleted
  → 🔴 Pipeline breaks at stage 9
  → ❌ Runtime generated NavigationCompleted but host never received it

Step 4 — EVIDENCE:
You: "Build evidence pack for navigation_stalled"
  → Hypothesis: navigation_stalled | Confidence: 0.82
  → Evidence: 8 items | Counter-evidence: 1 item | Timeline: 12 events
  → Would increase to 0.95 if DocStateSuppressed confirmed

Step 5 — FEEDBACK:
You: "Confirm root cause: yes, navigation_stalled, timing: NavigationTotal=3200"
  → KB updated: confirmed_count=4, timing baseline refined

Step 6 — SHARE:
You: "Share my learnings"
  → Preview: 1 updated root cause, 1 timing update
  → "Confirm" → pushed to GitHub
```

### Quick Lookups (anytime, no trace needed)

```
You: "What is WebView2_DifferentNavigationId?"
  → Navigation ID mismatch — full description, params, related events

You: "My WebView2 app is crashing"
  → diagnose: Decision tree — check BrowserProcessFailure, ProcessFailureTypeWithReason, exit codes

You: "List all Navigation events"
  → 35 events: NavigationStarting, ContentLoading, DOMContentLoaded, ...
```

### Deep Dives (only when needed)

### Deep Dives (only when needed)

```
You: "What happened between timestamps 32456789012 and 32461789012?"
  → timeline_slice: Event categories, active processes, errors, 1.6s silent gap

You: "Compare the working trace vs broken trace"
  → compare_etls: Side-by-side diff — missing events, timing gaps, failure-only errors

You: "Validate this trace against known happy paths"
  → validate_trace: ✅ Navigate (5/5 events), ❌ Initialize (missing 2 events)

You: "There's a 1.6s gap — what was PID 27528 doing on CPU?"
  → analyze_cpu: ⏳ CPU profiling commands with Edge symbol servers (deferred — only when needed)
```

### Learning & Sharing

```
You: "Validate this trace as a good example: C:\temp\working_nav.txt"
  → Mines API→event patterns from successful trace + auto-discovers new events
  → 💡 Tip: Run share_learnings to push these to the shared knowledge base.

You: "Share my learnings"
  → Preview: 3 new events, 2 updated timings, 1 new API sequence
  → "Looks good, confirm"
  → ✅ Pushed to GitHub — all users get these on next startup
```

---

## 📚 Knowledge Base

Ships pre-loaded — no setup required:

| File | Contents | Auto-grows? |
|------|----------|-------------|
| `api_ids.json` | 175 API IDs (Navigate, Initialize, GoBack, AddNavigationStarting, ...) | ✅ Via auto-discover |
| `events.json` | 189+ events across 15 categories | ✅ Via auto-discover |
| `root_causes.json` | 7 root causes (about:blank deadlock, VDI DLL loading, WAM failure, ...) | ✅ Via contribute |
| `timing_baselines.json` | 16 timing baselines with p50/p95/p99 | ✅ Via auto-extract |
| `api_sequences.json` | 12 API happy-path sequences (Navigate→events, Initialize→events, ...) | ✅ Via learn_good/learn_bad |
| `nav_playbooks.json` | Navigation & initialization lifecycle stages with expected events and failure variants | ✅ Via rca_feedback |
| `rca_taxonomy.json` | Expanded root-cause taxonomy: 5 categories, ~15 sub-causes with ETW signatures | ✅ Via rca_feedback |

---

## 🧠 How Auto-Learning Works

The knowledge base **grows automatically** with every trace analyzed — zero manual effort required.

### What Happens During Analysis

```
You: "Validate this trace at C:\temp\filtered.txt"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  1. AUTO-DISCOVER NEW EVENTS                    │
│     Scans every line. Unknown events are auto-  │
│     added to events.json with heuristic         │
│     category and severity.                      │
├─────────────────────────────────────────────────┤
│  2. EXTRACT TIMINGS                             │
│     NavigationTotal, CreationTime, WAM token    │
│     durations → running p50/p95/p99 averages    │
│     in timing_baselines.json.                   │
├─────────────────────────────────────────────────┤
│  3. EXTRACT FEATURE FLAGS                       │
│     --enable-features, --disable-features,      │
│     field trials, WebView2-specific flags        │
│     (msWebView2*, EdgeWebView*), runtime ver.   │
├─────────────────────────────────────────────────┤
│  4. VALIDATE API SEQUENCES                      │
│     Maps API calls → expected happy paths.      │
│     Reports: missing events, wrong order,       │
│     health score per API.                       │
├─────────────────────────────────────────────────┤
│  5. MINE NEW PATTERNS (learn_good / learn_bad)  │
│     Extracts API→event chains from traces.      │
│     Stores with confidence scores. Future       │
│     validations use mined patterns.             │
└─────────────────────────────────────────────────┘
                    │
                    ▼ All learnings saved locally
                    │
     You: "Share my learnings"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  6. PREVIEW & SHARE                             │
│     Shows diff: new events, updated timings,    │
│     new sequences. You review, then confirm.    │
│     Pushed to GitHub → every user gets them     │
│     on next server startup.                     │
└─────────────────────────────────────────────────┘
```

### User Effort Table

| Action | Effort | What Gets Learned |
|--------|--------|-------------------|
| Use `analyze_etl` + `validate_trace` normally | **Zero** | New events, timings, feature flags |
| Say `learn_good` when validating a working trace | **1 extra word** | API→event happy-path sequences |
| Say `learn_bad` when validating a broken trace | **1 extra word** | Failure patterns and indicators |
| Say `"share my learnings"` | **One phrase** | Pushes all discoveries to GitHub |
| Use `contribute_root_cause` after finding a bug | **Optional** | Root cause patterns for diagnosis |

---

## 📤 Sharing Learnings

Sharing is **explicit** — the server never pushes without your review.

### How It Works

1. **Analyze traces** as usual — the server learns locally (events, timings, patterns)
2. **Say `"share my learnings"`** — the server shows you a diff:

   ```
   ## 📤 Learnings Ready to Share
   
   **3 new** entries and **1 updated** across 2 knowledge files.
   
   ### 📋 Events (events.json)
   New (2):
     - `WebView2_FrameCreated` — Frame creation callback
     - `WebView2_CustomSchemeHandler` — Custom scheme registration
   
   ### ⏱️ Timing Baselines (timing_baselines.json)
   Updated (1):
     - `about_blank_navigation` — samples: 5 → 8
   
   To push, run share_learnings with action: "confirm".
   ```

3. **Say `"looks good, confirm"`** — changes are pushed to GitHub
4. **Every other user** pulls your discoveries on their next server startup

### Setup

**Most users need zero setup** — the server auto-detects your GitHub authentication:

| Auth Source | How It Works | Setup Needed |
|-------------|-------------|--------------|
| **VS Code GitHub sign-in** | Auto-detected from OS credential store (Copilot, Settings Sync, GitHub PRs) | **None** — already signed in |
| **`gh` CLI** | Auto-detected via `gh auth token` | **None** — already authenticated |
| **`GITHUB_TOKEN` env var** | Explicit token with repo write access (direct push) | One-time PAT creation |

The server tries each source in order. If you're signed into GitHub in VS Code or have the `gh` CLI, sharing works immediately.

**If no auth is detected**, the server tells you how to fix it:

```
🟡 Pull-only mode — receiving shared learnings but cannot share.

To enable sharing, do ONE of:
• Install gh CLI and run: gh auth login
• Sign into GitHub in VS Code
• Set GITHUB_TOKEN env var in your MCP config
```

#### How sharing works behind the scenes

- **Users with `GITHUB_TOKEN` env var** (repo collaborators): Direct push to the repo
- **Users with `gh` CLI or VS Code auth**: Creates a GitHub Issue with the knowledge diff → a GitHub Actions workflow automatically validates, merges, and commits

**Without any auth**: Everything still works. Learnings stay local, and you still **receive** others' shared discoveries (public repo, read access is free).

### What Gets Synced

| On Startup | On Share |
|------------|----------|
| Server **pulls** latest knowledge JSONs from GitHub | Server **pushes** your new discoveries back |
| Additive merge with local data (never loses entries) | Only pushes files with actual changes |
| Automatic — no user action needed | Explicit — requires preview + confirm |

---

## 🏗️ Architecture

```
webview2-etw-mcp-server/
├── src/
│   ├── index.ts                MCP server entry point (14 tools registered)
│   ├── tools/
│   │   ├── triage.ts           Step 2: Fast root-cause triage → Triage Card
│   │   ├── evidence_pack.ts    Step 4: Structured RCA evidence pack
│   │   ├── nav_playbook.ts     Step 3: Deterministic navigation lifecycle playbook
│   │   ├── rca_feedback.ts     Step 5: Feedback capture → guarded KB updates
│   │   ├── analyze.ts          Step 1: ETL extraction commands + feature flags
│   │   ├── analyze_cpu.ts      ⏳ Deferred: CPU profiling with 3 symbol servers
│   │   ├── timeline_slice.ts   Deep dive: between-timestamp event analysis
│   │   ├── validate_trace.ts   Deep dive: API happy-path validation + learning
│   │   ├── compare_etls.ts     Deep dive: two-ETL comparison
│   │   ├── decode.ts           Lookup: API ID decoding (175 IDs)
│   │   ├── lookup.ts           Lookup: event lookup with partial matching
│   │   ├── diagnose.ts         Lookup: 7 symptom decision trees
│   │   ├── contribute.ts       (legacy — superseded by rca_feedback)
│   │   ├── compare.ts          (legacy — superseded by compare_etls)
│   │   └── auto_learn.ts       Passive auto-learning (event discovery, timings)
│   ├── knowledge/
│   │   ├── loader.ts           JSON I/O with multi-mode path resolution
│   │   ├── sync.ts             GitHub sync: pull on startup, preview/confirm push
│   │   ├── api_ids.json        175 API ID mappings
│   │   ├── api_sequences.json  12 API happy-path sequences
│   │   ├── events.json         189+ ETW events across 15 categories
│   │   ├── root_causes.json    7 known root causes with evidence patterns
│   │   ├── timing_baselines.json  16 timing baselines with p50/p95/p99
│   │   ├── nav_playbooks.json  Navigation & init lifecycle playbooks
│   │   └── rca_taxonomy.json   Root-cause taxonomy (5 categories, ~15 sub-causes)
│   └── test.ts                 21 smoke tests
├── .github/
│   └── workflows/
│       └── process-learnings.yml  GitHub Actions: auto-process learning submissions
├── TOOLS_GUIDE.md              Human-language tool reference with examples
├── LICENSE                     MIT License
└── README.md                   This file
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **JSON knowledge base** (not a database) | Version-controlled, diffable, works offline, syncs via GitHub API |
| **Root-cause-first workflow** | Triage Card before deep dive — reduces time-to-first-signal |
| **Deterministic playbooks** | Repeatable, evidence-backed lifecycle checks (not heuristic) |
| **Confidence scoring** | Explicit "what would change confidence" — prevents false certainty |
| **Guarded KB updates** | Feedback only auto-applies safe changes (timings, event names); destructive changes logged |
| **Additive merge** (never delete) | Multiple users can learn concurrently without data loss |
| **Preview before push** | Users see exactly what's being shared — no surprises |
| **Pull on startup only** | Avoids API rate limits; 60-second cooldown between syncs |
| **Local-first** | Everything works without a token; sharing is opt-in |
| **stdio transport** | Works with any MCP-compatible client (VS Code, CLI, etc.) |

---

## 📌 Contributing

The server is designed to learn from usage — the best contribution is simply **using it**.

### Automatic (just use the tools)

| Step | What To Do | What Gets Learned |
|------|-----------|-------------------|
| 1 | **Analyze traces** with `analyze_etl` → `triage` → `nav_playbook` → `evidence_pack` | New events, timings, root causes (auto) |
| 2 | **Give feedback** with `rca_feedback` | Confirmed root causes, timing baselines, missing events |
| 3 | **Validate good traces** with `validate_trace` in `learn_good` mode | API→event happy-path sequences |
| 4 | **Share learnings** by saying `"share my learnings"` | Push discoveries to GitHub for all users |

### Manual (when you find something interesting)

| Step | What To Do | Impact |
|------|-----------|--------|
| 5 | **File issues** on GitHub for bugs, feature requests, new events | Improves the server for everyone |
| 6 | **PRs** — add tools, improve diagnosis trees, expand knowledge | Direct code contributions |

### How Shared Learning Works (for contributors with GITHUB_TOKEN)

```
┌──────────────────────────────────────────────────────────────────┐
│                    User A analyzes ETL                           │
│                         │                                        │
│                    Learns 3 new events                           │
│                         │                                        │
│              "Share my learnings" → preview                      │
│                         │                                        │
│              "Confirm" → pushes to GitHub                        │
│                                                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                                  │
│  User B starts server → pulls latest → gets User A's events     │
│                         │                                        │
│              Analyzes different ETL → learns 2 more events       │
│                         │                                        │
│              "Share my learnings" → pushes (merged with A's)     │
│                                                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                                  │
│  User A restarts → gets A's + B's events automatically          │
│                                                                  │
│  Knowledge base grows: 189 → 192 → 194 → ...                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## License

Licensed under the [MIT License](./LICENSE).

---

_Built for the Edge WebView2 team. Works with any WebView2 host application._
