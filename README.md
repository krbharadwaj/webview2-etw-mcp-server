# ⭐ WebView2 ETW Analysis MCP Server

Analyze WebView2 ETL traces with AI. **14 tools**, 189+ known events, 175 API IDs, 7 root causes, auto-learning & shared knowledge base.

---

## ✨ One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

Click the button above → VS Code opens → MCP server is configured. **That's it.**

---

## 📄 Table of Contents

1. [📺 Overview](#-overview)
2. [⚙️ All 14 Tools](#️-all-14-tools)
3. [🔌 Installation](#-installation)
4. [🎩 Usage Examples](#-usage-examples)
5. [📚 Knowledge Base](#-knowledge-base)
6. [🧠 How Auto-Learning Works](#-how-auto-learning-works)
7. [📤 Sharing Learnings](#-sharing-learnings)
8. [🏗️ Architecture](#️-architecture)
9. [📌 Contributing](#-contributing)

---

## 📺 Overview

The WebView2 ETW MCP Server brings WebView2 ETL trace analysis directly into GitHub Copilot Chat. Just talk in plain English:

- *"What is API ID 33?"* → `AddNavigationStarting` (category, critical flag, related events)
- *"Analyze C:\traces\stuck.etl for Teams"* → PowerShell extraction commands + feature flag extraction
- *"My WebView2 app is stuck"* → decision tree + known root causes + investigation commands
- *"What happened between timestamps X and Y?"* → event breakdown by category, errors, silent gaps
- *"Compare good.etl vs bad.etl for Outlook"* → side-by-side diff of events, timings, errors
- *"Validate this trace against known happy paths"* → API sequence validation + health report
- *"What was PID 27528 doing on CPU?"* → CPU profiling with Chromium + Edge + Microsoft symbol servers
- *"Share my learnings"* → preview diff of new knowledge, confirm to push to GitHub for all users

---

## ⚙️ All 14 Tools

### 🔍 Analysis Tools

| # | Tool | What It Does |
|---|------|-------------|
| 1 | `decode_api_id` | Decode WebView2 API ID numbers (0-174) → human-readable names, categories, critical flags. Supports batch decoding and category listing. |
| 2 | `lookup_event` | Look up any of 189+ ETW events by name (partial match supported) → description, parameters, severity, related events. List events by category. |
| 3 | `diagnose` | Decision trees for 7 symptoms: `stuck`, `crash`, `slow_init`, `slow_navigation`, `auth_failure`, `blank_page`, `event_missing`. Returns investigation commands and known root causes. |
| 4 | `analyze_etl` | Generate PowerShell commands to extract and filter ETL traces. Includes process discovery, WebView2 event filtering, feature flag extraction, and timeline building. |
| 5 | `analyze_cpu` | CPU profiling with 3 symbol servers (Chromium, Edge, Microsoft). Generates symbolized extraction commands or parses pre-extracted data for CPU time breakdown. |
| 6 | `timeline_slice` | Show what happened between two timestamps — events by category, active processes, errors, silent gaps. |

### 🔄 Comparison Tools

| # | Tool | What It Does |
|---|------|-------------|
| 7 | `compare_incarnations` | Compare SUCCESS vs FAILURE WebView2 incarnations side-by-side from filtered ETL dumps. Identifies the first divergence point. |
| 8 | `compare_etls` | Compare two ETL files end-to-end. Setup mode generates extraction commands; compare mode analyzes event differences, missing events, timing gaps, and failure-only errors. |

### 🧪 Validation & Learning Tools

| # | Tool | What It Does |
|---|------|-------------|
| 9 | `validate_trace` | Validate filtered ETL against 12 known API happy-path sequences. Reports missing events, wrong ordering, and deviations. Extracts feature flags. **`learn_good`** mode mines patterns from successful traces; **`learn_bad`** captures failure patterns. |
| 10 | `share_learnings` | **Preview** what new knowledge you've discovered locally (diff vs GitHub), then **confirm** to push — so all users benefit. Two-step flow: preview → review → confirm. |
| 11 | `sync_status` | Check if GitHub sync is active and whether your learnings are being shared. |

### 📝 Manual Contribution Tools

| # | Tool | What It Does |
|---|------|-------------|
| 12 | `contribute_event` | Add a new ETW event to the knowledge base with description, parameters, category, severity. |
| 13 | `contribute_root_cause` | Add a new root cause pattern with symptom, evidence, classification, and resolution. |
| 14 | `contribute_timing` | Update timing baselines with new observations. Running averages improve anomaly detection. |

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
      "args": ["-y", "github:krbharadwaj/webview2-etw-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "${input:github_token}"
      }
    }
  },
  "inputs": [
    {
      "id": "github_token",
      "type": "promptString",
      "description": "GitHub token for shared learning (optional — press Enter to skip)",
      "password": true
    }
  ]
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
        "args": ["-y", "github:krbharadwaj/webview2-etw-mcp-server"],
        "env": {
          "GITHUB_TOKEN": "ghp_your_token_here"
        }
      }
    }
  }
}
```

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
      "args": ["<path>/webview2-etw-mcp-server/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

---

## 🎩 Usage Examples

Switch to **Agent Mode** in GitHub Copilot Chat, then just ask:

### Full ETL Analysis Workflow

```
You: "I have an ETL at C:\traces\teams_stuck.etl. Teams is stuck."
  → Copilot gives you PowerShell extraction commands (process discovery,
    event filtering, feature flags, timeline building)

You: [paste the filtered output]
  → Server identifies API calls, events, errors, and gaps

You: "I see API IDs 7, 33, 37, 55. What are they?"
  → Initialize, AddNavigationStarting, AddNavigationCompleted, AddProcessFailed

You: "Validate this trace against known happy paths"
  → Health report per API: ✅ Navigate (5/5 events), ❌ Initialize (missing 2 events)
  → Feature flags: --enable-features=msWebView2..., runtime version 120.0.2210.91

You: "What happened between timestamps 32456789012 and 32461789012?"
  → Event categories, active processes, errors, 1.6s silent gap detected

You: "There's a 1.6s gap — what was PID 27528 doing on CPU?"
  → CPU profiling commands with Edge symbol servers

You: "Compare the working trace vs broken trace"
  → Side-by-side diff: missing events, timing differences, failure-only errors
```

### Quick Lookups

```
You: "What is WebView2_DifferentNavigationId?"
  → Navigation ID mismatch — full description, params, related events

You: "My WebView2 app is crashing"
  → Decision tree: check BrowserProcessFailure, ProcessFailureTypeWithReason, exit codes

You: "List all Navigation events"
  → 35 events: NavigationStarting, ContentLoading, DOMContentLoaded, ...
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

### Setup (one-time)

To share, you need a GitHub token with **Contents: Read and write** permission on this repo:

1. Go to [GitHub Settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. Select repository: `krbharadwaj/webview2-etw-mcp-server`
3. Permissions: **Contents → Read and write**
4. Add the token to your MCP config as `GITHUB_TOKEN` (see [Installation](#-installation))

**Without a token**: Everything still works. Learnings stay local, and you still **receive** others' shared discoveries (public repo, read access is free).

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
│   │   ├── decode.ts           API ID decoding (175 IDs, batch mode, category listing)
│   │   ├── lookup.ts           Event lookup with fuzzy/partial matching
│   │   ├── diagnose.ts         7 symptom decision trees with root cause matching
│   │   ├── analyze.ts          ETL extraction commands + feature flag extraction
│   │   ├── analyze_cpu.ts      CPU profiling with 3 symbol servers (Chromium, Edge, MS)
│   │   ├── timeline_slice.ts   Between-timestamp event analysis with gap detection
│   │   ├── validate_trace.ts   API happy-path validation + pattern mining + feature flags
│   │   ├── compare.ts          SUCCESS vs FAILURE incarnation comparison
│   │   ├── compare_etls.ts     Two-ETL end-to-end comparison
│   │   ├── contribute.ts       Manual knowledge base enrichment (events, root causes, timings)
│   │   └── auto_learn.ts       Passive auto-learning module (event discovery, timing extraction)
│   ├── knowledge/
│   │   ├── loader.ts           JSON I/O with multi-mode path resolution (dev/compiled/npm)
│   │   ├── sync.ts             GitHub sync: pull on startup, preview/confirm push, additive merge
│   │   ├── api_ids.json        175 API ID mappings
│   │   ├── api_sequences.json  12 API happy-path sequences with confidence scores
│   │   ├── events.json         189+ ETW events across 15 categories
│   │   ├── root_causes.json    7 known root causes with evidence patterns
│   │   └── timing_baselines.json  16 timing baselines with running p50/p95/p99
│   └── test.ts                 21 smoke tests
├── TOOLS_GUIDE.md              Human-language tool reference with examples
├── LICENSE                     MIT License
└── README.md                   This file
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **JSON knowledge base** (not a database) | Version-controlled, diffable, works offline, syncs via GitHub API |
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
| 1 | **Analyze traces** with `analyze_etl` + `validate_trace` | New events, timings, feature flags (auto) |
| 2 | **Validate good traces** with `learn_good` mode | API→event happy-path sequences |
| 3 | **Validate bad traces** with `learn_bad` mode | Failure patterns and indicators |
| 4 | **Share learnings** by saying `"share my learnings"` | Push discoveries to GitHub for all users |

### Manual (when you find something interesting)

| Step | What To Do | Impact |
|------|-----------|--------|
| 5 | **Share root causes** with `contribute_root_cause` | Diagnosis trees get smarter |
| 6 | **Add events** with `contribute_event` for deeply documented events | Event lookup becomes richer |
| 7 | **File issues** on GitHub for bugs, feature requests, new events | Improves the server for everyone |
| 8 | **PRs** — add tools, improve diagnosis trees, expand knowledge | Direct code contributions |

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
