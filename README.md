# ⭐ WebView2 ETW Analysis MCP Server

Analyze WebView2 ETL traces with AI. 11 tools, 189 known events, 7 root causes, auto-learning knowledge base.

---

## ✨ One-Click Install

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_WebView2_ETW_MCP-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_WebView2_ETW_MCP-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=webview2-etw&quality=insiders&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Akrbharadwaj%2Fwebview2-etw-mcp-server%22%5D%7D)

Click the button above → VS Code opens → MCP server is configured. **That's it.**

---

## 📄 Table of Contents

1. [📺 Overview](#-overview)
2. [⚙️ All 11 Tools](#️-all-11-tools)
3. [🔌 Installation](#-installation)
4. [🎩 Usage Examples](#-usage-examples)
5. [📚 Knowledge Base](#-knowledge-base)
6. [🏗️ Architecture](#️-architecture)
7. [📌 Contributing](#-contributing)

## 📺 Overview

The WebView2 ETW MCP Server brings WebView2 ETL trace analysis directly into GitHub Copilot. Just talk in plain English:

- *"What is API ID 33?"* → `AddNavigationStarting`
- *"Analyze C:\traces\stuck.etl for Teams"* → extraction commands
- *"My WebView2 app is stuck"* → decision tree + root causes
- *"What happened between timestamps X and Y?"* → event breakdown
- *"Compare good.etl vs bad.etl for Outlook"* → side-by-side diff
- *"What was PID 27528 doing on CPU?"* → CPU profiling with Edge symbol servers

## ⚙️ All 11 Tools

| # | Tool | Purpose |
|---|------|---------|
| 1 | `decode_api_id` | Decode WebView2 API ID numbers (0-174) → human-readable names |
| 2 | `lookup_event` | Look up any of 189 ETW events — description, params, severity |
| 3 | `diagnose` | Decision trees for: stuck, crash, slow_init, auth_failure, slow_nav, memory, renderer |
| 4 | `analyze_etl` | Generate PowerShell extraction commands for ETL files |
| 5 | `compare_incarnations` | Compare SUCCESS vs FAILURE event timelines |
| 6 | `compare_etls` | Compare two ETL files end-to-end |
| 7 | `analyze_cpu` | CPU profiling with Chromium + Edge + Microsoft symbol servers |
| 8 | `timeline_slice` | What happened between two timestamps (categories, gaps, errors) |
| 9 | `contribute_event` | Add events to KB (optional — server auto-learns) |
| 10 | `contribute_root_cause` | Add root causes (optional) |
| 11 | `contribute_timing` | Update timing baselines (optional) |

See **[TOOLS_GUIDE.md](TOOLS_GUIDE.md)** for the complete reference with human-language examples.

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

Or add to VS Code `settings.json` (global):

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

### 🧠 Shared Learning (Optional)

Set `GITHUB_TOKEN` to enable shared learning. When you analyze traces, your discoveries (new events, timing baselines, API sequences) are automatically pushed back to this repo so **all users benefit**.

Without a token, the server works normally but learnings stay local.

To create a token: [GitHub Settings → Developer settings → Personal access tokens → Fine-grained](https://github.com/settings/personal-access-tokens/new) with `Contents: Read and write` permission on this repo.
```

### 🔧 From Source

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

## 🎩 Usage Examples

Switch to **Agent Mode** in GitHub Copilot Chat, then just ask:

### ETL Analysis Workflow

```
You: "I have an ETL at C:\traces\teams_stuck.etl. Teams is stuck."
  → Copilot gives you PowerShell extraction commands

You: "I see API IDs 7, 33, 37, 55. What are they?"
  → Initialize, AddNavigationStarting, AddNavigationCompleted, AddProcessFailed

You: "What happened between timestamps 32456789012 and 32461789012?"
  → Event categories, active processes, errors, silent gaps

You: "There's a 1.6s gap — what was PID 27528 doing on CPU?"
  → CPU profiling commands with Edge symbol servers

You: "Compare the working trace vs broken trace"
  → Side-by-side diff: missing events, timing differences, failure-only errors
```

### Quick Lookups

```
You: "What is WebView2_DifferentNavigationId?"
  → Navigation ID mismatch detected — full description, params, related events

You: "My WebView2 app is crashing"
  → Decision tree: check BrowserProcessFailure, ProcessFailureTypeWithReason, exit codes
```

## 📚 Knowledge Base

Ships pre-loaded — no setup required:

| File | Contents |
|------|----------|
| `api_ids.json` | 175 API IDs (Navigate, Initialize, GoBack, AddNavigationStarting, ...) |
| `events.json` | 189 events across 15 categories |
| `root_causes.json` | 7 root causes (about:blank deadlock, VDI DLL loading, WAM failure, ...) |
| `timing_baselines.json` | 16 timing baselines with p50/p95/p99 |
| `api_sequences.json` | 12 API happy-path sequences (Navigate→events, Initialize→events, ...) |

## 🧠 How Auto-Learning Works

The knowledge base **grows automatically** — no manual work required from users.

### What Happens When You Analyze a Trace

```
You: "Validate this trace at C:\temp\filtered.txt"
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ 1. AUTO-DISCOVER NEW EVENTS                 │
│    Server scans every line in the trace.    │
│    Unknown events → auto-added to events.json│
│    with heuristic category/severity.        │
├─────────────────────────────────────────────┤
│ 2. EXTRACT TIMINGS                          │
│    NavigationTotal, CreationTime, WAM token  │
│    durations → update timing_baselines.json  │
│    (running p50/p95/p99 averages)           │
├─────────────────────────────────────────────┤
│ 3. VALIDATE API SEQUENCES                   │
│    Maps API calls → expected happy paths.    │
│    Reports missing events, wrong order,      │
│    failure indicators.                       │
├─────────────────────────────────────────────┤
│ 4. MINE NEW PATTERNS (learn_good/learn_bad) │
│    Extracts API→event chains from traces.    │
│    Stores with confidence scores.            │
│    Future validations use mined patterns.    │
├─────────────────────────────────────────────┤
│ 5. EXTRACT FEATURE FLAGS                    │
│    --enable-features, --disable-features,    │
│    field trials, WebView2-specific flags,    │
│    runtime version.                          │
└─────────────────────────────────────────────┘
                    │
                    ▼ (if GITHUB_TOKEN is set)
┌─────────────────────────────────────────────┐
│ 6. SYNC TO GITHUB                           │
│    Push updated JSONs back to the repo.      │
│    Next user who starts the server gets      │
│    EVERYONE's discoveries automatically.     │
└─────────────────────────────────────────────┘
```

### What Users Need to Do

| Action | Effort | What Gets Learned |
|--------|--------|-------------------|
| Just use `analyze_etl` + `validate_trace` | **Zero effort** | New events, timings, feature flags |
| Run `validate_trace` with `learn_good` mode on a working trace | **1 extra word** | API→event happy-path sequences |
| Run `validate_trace` with `learn_bad` mode on a broken trace | **1 extra word** | Failure patterns and indicators |
| Set `GITHUB_TOKEN` env var | **One-time setup** | Share all discoveries with every user |
| Use `contribute_root_cause` after finding a bug | **Optional** | Root cause patterns for diagnosis |

### Shared Learning (GitHub Sync)

When `GITHUB_TOKEN` is set:
- **On startup**: Server pulls the latest knowledge from this GitHub repo
- **After learning**: Server pushes new discoveries back
- **Merge strategy**: Additive — never loses entries, local + remote are merged

This means every ETL analysis by any user makes the server smarter for everyone.

**Without a token**: Everything still works — learnings just stay on your local machine.

## 🏗️ Architecture

```
webview2-etw-mcp-server/
├── src/
│   ├── index.ts              MCP server entry (13 tools)
│   ├── tools/
│   │   ├── decode.ts         API ID decoding (175 IDs)
│   │   ├── lookup.ts         Event lookup with fuzzy matching
│   │   ├── diagnose.ts       7 symptom decision trees
│   │   ├── analyze.ts        ETL extraction + feature flag commands
│   │   ├── analyze_cpu.ts    CPU profiling with 3 symbol servers
│   │   ├── timeline_slice.ts Between-timestamp analysis
│   │   ├── validate_trace.ts API happy-path validation + pattern mining
│   │   ├── compare.ts        Incarnation comparison
│   │   ├── compare_etls.ts   Two-ETL comparison
│   │   ├── contribute.ts     Manual KB enrichment
│   │   └── auto_learn.ts     Auto-learning from analysis
│   └── knowledge/
│       ├── loader.ts         JSON I/O with multi-mode path resolution
│       ├── sync.ts           GitHub sync (pull on start, push on learn)
│       ├── api_ids.json      175 API IDs
│       ├── api_sequences.json 12 API happy-path sequences
│       ├── events.json       189 events
│       ├── root_causes.json  7 root causes
│       └── timing_baselines.json  16 baselines
├── TOOLS_GUIDE.md            Human-language tool reference
└── README.md                 This file
```

## 📌 Contributing

The server is designed to learn from usage — the best contribution is simply **using it**!

### Automatic (just use the tools)
1. **Analyze traces** — `analyze_etl` + `validate_trace` auto-discovers new events and timings
2. **Validate working traces** — `validate_trace` with `learn_good` mode auto-mines API→event sequences
3. **Validate broken traces** — `validate_trace` with `learn_bad` mode captures failure patterns
4. **Set `GITHUB_TOKEN`** — your discoveries automatically benefit every other user

### Manual (when you find something interesting)
5. **Share root causes** — use `contribute_root_cause` when you find a new failure pattern
6. **Add events** — use `contribute_event` for events you've documented deeply
7. **File issues** — bugs, feature requests, new event documentation
8. **PRs** — add tools, improve diagnosis trees, expand the knowledge base

## License

Licensed under the [MIT License](./LICENSE).

---

_Built for the Edge WebView2 team. Works with any WebView2 host application._
