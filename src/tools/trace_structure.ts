/**
 * trace_structure: Extracts structured information from filtered ETL data.
 *
 * Produces:
 *   1. Configuration: feature flags, runtime/SDK version, command lines
 *   2. Process tree: host app → WebView2 browser → renderer/utility/GPU
 *   3. Per-process activity summary
 *   4. Initial issue detection: errors, missing signals, anomalies
 */

import { readFileSync } from "fs";

// ─── Types ──────────────────────────────────────────────────────────

interface ProcessInfo {
  name: string;
  pid: number;
  eventCount: number;
  firstTs: number;
  lastTs: number;
  role: string;         // "host", "browser", "renderer", "utility", "gpu", "crashpad", "unknown"
  parentPid: number | null;
  keyEvents: string[];
  errors: string[];
}

interface Configuration {
  runtimeVersion: string | null;
  sdkVersion: string | null;
  browserVersion: string | null;
  channelName: string | null;
  userDataFolder: string | null;
  enabledFeatures: string[];
  disabledFeatures: string[];
  webview2Flags: string[];
  fieldTrials: string[];
  commandLineArgs: string[];
  environmentInfo: string[];
}

interface InitialIssue {
  severity: "🔴 critical" | "🟡 warning" | "🔵 info";
  message: string;
  evidence: string;
}

export interface TraceStructure {
  config: Configuration;
  processes: ProcessInfo[];
  processTree: string;      // formatted tree
  activitySummary: string;  // formatted table
  issues: InitialIssue[];
  issuesSummary: string;    // formatted
  traceSpanMs: number;
  totalLines: number;
  totalEvents: number;
}

// ─── Main entry point ───────────────────────────────────────────────

export function extractTraceStructure(
  filteredFile: string,
  hostApp: string
): TraceStructure {
  const content = readFileSync(filteredFile, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());

  const config = extractConfiguration(lines);
  const processes = extractProcesses(lines, hostApp);
  const issues = detectInitialIssues(lines, processes, config, hostApp);

  // Trace time span
  const timestamps = lines
    .map(l => extractTs(l))
    .filter((t): t is number => t !== null);
  const minTs = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const traceSpanMs = (maxTs - minTs) / 1000;

  return {
    config,
    processes,
    processTree: formatProcessTree(processes, hostApp),
    activitySummary: formatActivitySummary(processes, minTs),
    issues,
    issuesSummary: formatIssues(issues),
    traceSpanMs,
    totalLines: lines.length,
    totalEvents: timestamps.length,
  };
}

export function formatTraceStructureReport(ts: TraceStructure, hostApp: string): string {
  const out: string[] = [];

  // ── Section 1: Configuration ──
  out.push("## 📋 Configuration");
  out.push("");
  out.push("| Property | Value |");
  out.push("|----------|-------|");
  out.push(`| Runtime Version | ${ts.config.runtimeVersion || "—"} |`);
  out.push(`| SDK Version | ${ts.config.sdkVersion || "—"} |`);
  out.push(`| Browser Version | ${ts.config.browserVersion || "—"} |`);
  out.push(`| Channel | ${ts.config.channelName || "—"} |`);
  out.push(`| User Data Folder | ${ts.config.userDataFolder || "—"} |`);
  out.push(`| Trace Duration | ${ts.traceSpanMs.toFixed(0)}ms |`);
  out.push(`| Total Events | ${ts.totalEvents.toLocaleString()} (${ts.totalLines.toLocaleString()} lines) |`);
  out.push(`| Processes | ${ts.processes.length} |`);
  out.push("");

  if (ts.config.enabledFeatures.length > 0) {
    out.push("### Enabled Features");
    out.push("```");
    for (const f of ts.config.enabledFeatures.slice(0, 30)) {
      out.push(f);
    }
    if (ts.config.enabledFeatures.length > 30)
      out.push(`... +${ts.config.enabledFeatures.length - 30} more`);
    out.push("```");
    out.push("");
  }

  if (ts.config.disabledFeatures.length > 0) {
    out.push("### Disabled Features");
    out.push("```");
    for (const f of ts.config.disabledFeatures.slice(0, 20)) {
      out.push(f);
    }
    if (ts.config.disabledFeatures.length > 20)
      out.push(`... +${ts.config.disabledFeatures.length - 20} more`);
    out.push("```");
    out.push("");
  }

  if (ts.config.webview2Flags.length > 0) {
    out.push("### WebView2-Specific Flags");
    out.push("```");
    for (const f of ts.config.webview2Flags) out.push(f);
    out.push("```");
    out.push("");
  }

  if (ts.config.fieldTrials.length > 0) {
    out.push("### Field Trials");
    out.push("```");
    for (const f of ts.config.fieldTrials.slice(0, 15)) out.push(f);
    if (ts.config.fieldTrials.length > 15)
      out.push(`... +${ts.config.fieldTrials.length - 15} more`);
    out.push("```");
    out.push("");
  }

  if (ts.config.commandLineArgs.length > 0) {
    out.push("### Other Command Line Arguments");
    out.push("```");
    for (const a of ts.config.commandLineArgs.slice(0, 15)) out.push(a);
    if (ts.config.commandLineArgs.length > 15)
      out.push(`... +${ts.config.commandLineArgs.length - 15} more`);
    out.push("```");
    out.push("");
  }

  // ── Section 2: Process Tree ──
  out.push("---");
  out.push("");
  out.push("## 🌲 Process Tree");
  out.push("");
  out.push(ts.processTree);
  out.push("");

  // ── Section 3: Process Activity ──
  out.push("---");
  out.push("");
  out.push("## 📊 Process Activity Summary");
  out.push("");
  out.push(ts.activitySummary);
  out.push("");

  // ── Section 4: Initial Issues ──
  if (ts.issues.length > 0) {
    out.push("---");
    out.push("");
    out.push("## ⚡ Initial Issue Detection");
    out.push("");
    out.push(ts.issuesSummary);
    out.push("");
  }

  return out.join("\n");
}

// ─── Configuration extraction ───────────────────────────────────────

function extractConfiguration(lines: string[]): Configuration {
  const config: Configuration = {
    runtimeVersion: null,
    sdkVersion: null,
    browserVersion: null,
    channelName: null,
    userDataFolder: null,
    enabledFeatures: [],
    disabledFeatures: [],
    webview2Flags: [],
    fieldTrials: [],
    commandLineArgs: [],
    environmentInfo: [],
  };

  const enabledSet = new Set<string>();
  const disabledSet = new Set<string>();
  const wv2FlagSet = new Set<string>();
  const trialSet = new Set<string>();
  const cmdArgSet = new Set<string>();

  for (const line of lines) {
    // Runtime version: from Creation events or version strings
    if (!config.runtimeVersion) {
      const rv = line.match(/RuntimeVersion[=:]\s*["']?(\d+\.\d+\.\d+\.\d+)/i)
        || line.match(/runtime[_\s]version[=:]\s*(\d+\.\d+\.\d+\.\d+)/i)
        || line.match(/msedgewebview2\.exe.*?(\d+\.\d+\.\d+\.\d+)/i);
      if (rv) config.runtimeVersion = rv[1];
    }

    // SDK version
    if (!config.sdkVersion) {
      const sv = line.match(/SdkVersion[=:]\s*["']?(\d+\.\d+\.\d+[\.\-]\w+)/i)
        || line.match(/sdk[_\s]version[=:]\s*(\d+\.\d+\.\d+)/i)
        || line.match(/WebView2Loader\.dll.*?(\d+\.\d+\.\d+\.\d+)/i);
      if (sv) config.sdkVersion = sv[1];
    }

    // Browser version
    if (!config.browserVersion) {
      const bv = line.match(/BrowserVersion[=:]\s*["']?(\d+\.\d+\.\d+\.\d+)/i)
        || line.match(/msedge\.dll.*?(\d+\.\d+\.\d+\.\d+)/i);
      if (bv) config.browserVersion = bv[1];
    }

    // Channel
    if (!config.channelName) {
      const ch = line.match(/Channel[=:]\s*["']?(\w+)/i);
      if (ch && ["stable", "beta", "dev", "canary", "internal"].includes(ch[1].toLowerCase())) {
        config.channelName = ch[1];
      }
    }

    // User data folder
    if (!config.userDataFolder) {
      const udf = line.match(/UserDataFolder[=:]\s*["']?([^\s"',]+)/i)
        || line.match(/user[_\s]data[_\s]dir[=:]\s*["']?([^\s"',]+)/i);
      if (udf) config.userDataFolder = udf[1];
    }

    // Enabled features
    const efMatch = line.match(/enable-features[=:]([^\s;,"]+)/i);
    if (efMatch) {
      for (const f of efMatch[1].split(",").filter(Boolean)) enabledSet.add(f.trim());
    }

    // Disabled features
    const dfMatch = line.match(/disable-features[=:]([^\s;,"]+)/i);
    if (dfMatch) {
      for (const f of dfMatch[1].split(",").filter(Boolean)) disabledSet.add(f.trim());
    }

    // WebView2-specific flags (msWebView2*, EdgeWebView*, WebView2Feature*)
    const wv2Matches = line.matchAll(/\b(msWebView2\w+|EdgeWebView\w+|WebView2Feature\w+|IsEdge\w+Enabled)\b/g);
    for (const m of wv2Matches) wv2FlagSet.add(m[1]);

    // Field trials
    const ftMatch = line.match(/field-trial[^=]*[=:]([^\s;,"]+)/i);
    if (ftMatch) {
      for (const t of ftMatch[1].split(",").filter(Boolean)) trialSet.add(t.trim());
    }

    // Interesting command line args
    const cmdPatterns = [
      /--(\w[\w-]+=\S+)/g,
      /(--no-sandbox)/g,
      /(--disable-gpu)/g,
      /(--single-process)/g,
      /(--disable-web-security)/g,
      /(--remote-debugging-port=\d+)/g,
      /(--js-flags=[^\s]+)/g,
    ];
    for (const pat of cmdPatterns) {
      const matches = line.matchAll(pat);
      for (const m of matches) {
        const arg = m[1];
        if (!arg.includes("enable-features") && !arg.includes("disable-features") &&
            !arg.includes("field-trial")) {
          cmdArgSet.add(arg);
        }
      }
    }
  }

  config.enabledFeatures = [...enabledSet].sort();
  config.disabledFeatures = [...disabledSet].sort();
  config.webview2Flags = [...wv2FlagSet].sort();
  config.fieldTrials = [...trialSet].sort();
  config.commandLineArgs = [...cmdArgSet].sort();

  return config;
}

// ─── Process extraction ─────────────────────────────────────────────

function extractProcesses(lines: string[], hostApp: string): ProcessInfo[] {
  const processMap = new Map<number, ProcessInfo>();
  const hostAppLower = hostApp.toLowerCase();

  for (const line of lines) {
    // Match: processname.exe (PID) or processname.exe     (PID)
    const procMatch = line.match(/(\S+\.exe)\s+\((\d+)\)/i)
      || line.match(/(\S+\.exe)\s*\((\d+)\)/i);
    if (!procMatch) continue;

    const name = procMatch[1];
    const pid = parseInt(procMatch[2], 10);
    const ts = extractTs(line) || 0;

    if (!processMap.has(pid)) {
      processMap.set(pid, {
        name,
        pid,
        eventCount: 0,
        firstTs: ts,
        lastTs: ts,
        role: classifyProcess(name, hostAppLower, line),
        parentPid: null,
        keyEvents: [],
        errors: [],
      });
    }

    const proc = processMap.get(pid)!;
    proc.eventCount++;
    if (ts > 0 && ts < proc.firstTs) proc.firstTs = ts;
    if (ts > proc.lastTs) proc.lastTs = ts;

    // Track key events (limit to avoid bloat)
    const eventName = extractEventName(line);
    if (eventName && isKeyEvent(eventName) && proc.keyEvents.length < 20) {
      if (!proc.keyEvents.includes(eventName)) proc.keyEvents.push(eventName);
    }

    // Track errors
    if (isErrorLine(line) && proc.errors.length < 10) {
      const errSummary = (eventName || line.slice(0, 80)).trim();
      if (!proc.errors.includes(errSummary)) proc.errors.push(errSummary);
    }

    // Detect parent PID from process start events
    const parentMatch = line.match(/ParentPID[=:]\s*(\d+)/i)
      || line.match(/Parent Process ID[=:]\s*(\d+)/i);
    if (parentMatch) proc.parentPid = parseInt(parentMatch[1], 10);
  }

  return [...processMap.values()].sort((a, b) => a.firstTs - b.firstTs);
}

function classifyProcess(name: string, hostAppLower: string, line: string): string {
  const nameLower = name.toLowerCase();

  if (nameLower.includes(hostAppLower) || nameLower.replace(".exe", "").includes(hostAppLower)) {
    return "host";
  }
  if (nameLower.includes("msedgewebview2")) {
    // Sub-classify by type hints in the line
    if (line.includes("--type=renderer") || line.includes("RendererMain")) return "renderer";
    if (line.includes("--type=utility") || line.includes("UtilityMain")) return "utility";
    if (line.includes("--type=gpu") || line.includes("GpuMain")) return "gpu";
    if (line.includes("--type=crashpad") || line.includes("crashpad")) return "crashpad";
    if (line.includes("BrowserMain") || line.includes("WebView2_Creation") || line.includes("WebView2_Factory")) return "browser";
    return "webview2";  // generic, will refine below
  }
  if (nameLower.includes("msedge")) return "edge";
  if (nameLower.includes("crashpad")) return "crashpad";
  return "other";
}

function isKeyEvent(eventName: string): boolean {
  const keyPatterns = [
    "WebView2_Creation", "WebView2_Factory", "WebView2_APICalled",
    "WebView2_NavigationStarting", "WebView2_NavigationCompleted",
    "WebView2_ContentLoading", "WebView2_DOMContentLoaded",
    "WebView2_SourceChanged", "WebView2_BrowserProcessFailure",
    "WebView2_ProcessFailed", "WebView2_Event_",
    "NavigationRequest::", "WebView2_DocState",
    "WebView2_NoHandlers", "WebView2_NavIdNotFound",
    "WebView2_DroppedEvent", "WebView2_IFrameNotFound",
    "Process/Start", "Process/End",
  ];
  return keyPatterns.some(p => eventName.includes(p));
}

function isErrorLine(line: string): boolean {
  return /\b(Failed|Failure|Error|Invalid|Timeout|Unresponsive|Crash|exception|abort)\b/i.test(line)
    && !/Process Name \( PID\)/i.test(line);
}

// ─── Process tree formatting ────────────────────────────────────────

function formatProcessTree(processes: ProcessInfo[], hostApp: string): string {
  const out: string[] = [];

  // Group by role
  const hostProcs = processes.filter(p => p.role === "host");
  const browserProcs = processes.filter(p => p.role === "browser");
  const rendererProcs = processes.filter(p => p.role === "renderer");
  const utilityProcs = processes.filter(p => p.role === "utility");
  const gpuProcs = processes.filter(p => p.role === "gpu");
  const wv2Generic = processes.filter(p => p.role === "webview2");
  const crashpadProcs = processes.filter(p => p.role === "crashpad");
  const otherProcs = processes.filter(p => ["other", "edge"].includes(p.role));

  // Try to refine generic webview2 processes
  // The first webview2 process is usually the browser
  if (browserProcs.length === 0 && wv2Generic.length > 0) {
    // Promote the one with Creation/Factory events to browser
    const browserCandidate = wv2Generic.find(p =>
      p.keyEvents.some(e => e.includes("Creation") || e.includes("Factory") || e.includes("BrowserMain"))
    ) || wv2Generic[0]; // fallback: first webview2 process
    browserCandidate.role = "browser";
    browserProcs.push(browserCandidate);
    const idx = wv2Generic.indexOf(browserCandidate);
    if (idx >= 0) wv2Generic.splice(idx, 1);

    // Rest are likely renderers
    for (const p of wv2Generic) {
      p.role = "renderer";
      rendererProcs.push(p);
    }
    wv2Generic.length = 0;
  }

  out.push("```");

  // Format each host app
  if (hostProcs.length > 0) {
    for (const host of hostProcs) {
      out.push(`📦 ${host.name} (PID ${host.pid}) [HOST]  — ${host.eventCount} events`);

      // Show browser processes under this host
      for (const bp of browserProcs) {
        const errs = bp.errors.length > 0 ? ` ⚠️ ${bp.errors.length} errors` : "";
        out.push(`  ├── 🌐 ${bp.name} (PID ${bp.pid}) [BROWSER]  — ${bp.eventCount} events${errs}`);

        // Renderers under browser
        for (let i = 0; i < rendererProcs.length; i++) {
          const rp = rendererProcs[i];
          const last = i === rendererProcs.length - 1 && utilityProcs.length === 0 && gpuProcs.length === 0;
          const connector = last ? "└──" : "├──";
          const errs2 = rp.errors.length > 0 ? ` ⚠️ ${rp.errors.length} errors` : "";
          out.push(`  │   ${connector} 📄 ${rp.name} (PID ${rp.pid}) [RENDERER]  — ${rp.eventCount} events${errs2}`);
        }

        // Utility
        for (let i = 0; i < utilityProcs.length; i++) {
          const up = utilityProcs[i];
          const last = i === utilityProcs.length - 1 && gpuProcs.length === 0;
          const connector = last ? "└──" : "├──";
          out.push(`  │   ${connector} 🔧 ${up.name} (PID ${up.pid}) [UTILITY]  — ${up.eventCount} events`);
        }

        // GPU
        for (const gp of gpuProcs) {
          out.push(`  │   └── 🎮 ${gp.name} (PID ${gp.pid}) [GPU]  — ${gp.eventCount} events`);
        }
      }

      // Generic webview2 (unclassified)
      for (const wp of wv2Generic) {
        out.push(`  ├── ❓ ${wp.name} (PID ${wp.pid}) [WEBVIEW2]  — ${wp.eventCount} events`);
      }

      // Crashpad
      for (const cp of crashpadProcs) {
        out.push(`  └── 🛡️ ${cp.name} (PID ${cp.pid}) [CRASHPAD]  — ${cp.eventCount} events`);
      }
    }
  } else {
    // No host process found — show flat
    out.push(`⚠️ Host app "${hostApp}" not found in trace. Showing all processes:`);
    for (const p of processes) {
      const icon = p.role === "browser" ? "🌐" : p.role === "renderer" ? "📄" : p.role === "utility" ? "🔧" : "❓";
      out.push(`${icon} ${p.name} (PID ${p.pid}) [${p.role.toUpperCase()}]  — ${p.eventCount} events`);
    }
  }

  // Other processes (not WebView2 related)
  if (otherProcs.length > 0) {
    out.push("");
    out.push("Other processes in trace:");
    for (const op of otherProcs.slice(0, 5)) {
      out.push(`  • ${op.name} (PID ${op.pid})  — ${op.eventCount} events`);
    }
    if (otherProcs.length > 5) out.push(`  • ... +${otherProcs.length - 5} more`);
  }

  out.push("```");
  return out.join("\n");
}

// ─── Activity summary ───────────────────────────────────────────────

function formatActivitySummary(processes: ProcessInfo[], minTs: number): string {
  const out: string[] = [];

  // Filter to processes with meaningful event counts
  const active = processes
    .filter(p => p.eventCount > 0)
    .sort((a, b) => b.eventCount - a.eventCount);

  out.push("| Process | PID | Role | Events | Active Window | Key Events | Errors |");
  out.push("|---------|-----|------|--------|---------------|------------|--------|");

  for (const p of active.slice(0, 15)) {
    const startMs = minTs > 0 ? ((p.firstTs - minTs) / 1000).toFixed(0) : "?";
    const endMs = minTs > 0 ? ((p.lastTs - minTs) / 1000).toFixed(0) : "?";
    const window = startMs !== "?" ? `+${startMs}ms → +${endMs}ms` : "—";
    const keys = p.keyEvents.slice(0, 3).join(", ") + (p.keyEvents.length > 3 ? ` +${p.keyEvents.length - 3}` : "");
    const errs = p.errors.length > 0 ? `⚠️ ${p.errors.length}` : "✅ 0";
    out.push(`| ${p.name} | ${p.pid} | ${p.role} | ${p.eventCount} | ${window} | ${keys || "—"} | ${errs} |`);
  }

  if (active.length > 15) {
    out.push(`| ... | | | | | | ${active.length - 15} more processes |`);
  }

  return out.join("\n");
}

// ─── Initial issue detection ────────────────────────────────────────

function detectInitialIssues(
  lines: string[],
  processes: ProcessInfo[],
  config: Configuration,
  hostApp: string
): InitialIssue[] {
  const issues: InitialIssue[] = [];

  // 1. No host app process found
  const hasHost = processes.some(p => p.role === "host");
  if (!hasHost) {
    issues.push({
      severity: "🟡 warning",
      message: `Host app "${hostApp}" not found in trace processes`,
      evidence: `Processes found: ${processes.map(p => p.name).join(", ")}`,
    });
  }

  // 2. No browser process
  const hasBrowser = processes.some(p => p.role === "browser" || p.role === "webview2");
  if (!hasBrowser) {
    issues.push({
      severity: "🔴 critical",
      message: "No WebView2 browser process found in trace",
      evidence: "No msedgewebview2.exe or browser-role process detected",
    });
  }

  // 3. Process failures
  const hasProcessFailure = lines.some(l =>
    l.includes("WebView2_BrowserProcessFailure") || l.includes("WebView2_ProcessFailed"));
  if (hasProcessFailure) {
    issues.push({
      severity: "🔴 critical",
      message: "WebView2 browser process failure detected",
      evidence: "WebView2_BrowserProcessFailure or WebView2_ProcessFailed event found",
    });
  }

  // 4. Creation failures
  const hasCreationFailure = lines.some(l => l.includes("WebView2_CreationFailure"));
  if (hasCreationFailure) {
    issues.push({
      severity: "🔴 critical",
      message: "WebView2 creation failure detected",
      evidence: "WebView2_CreationFailure event found — WebView2 failed to initialize",
    });
  }

  // 5. Missing NavigationCompleted (common issue)
  const hasNavStart = lines.some(l => l.includes("WebView2_NavigationStarting"));
  const hasNavComplete = lines.some(l => l.includes("WebView2_NavigationCompleted"));
  if (hasNavStart && !hasNavComplete) {
    issues.push({
      severity: "🟡 warning",
      message: "NavigationStarting found but NavigationCompleted never received",
      evidence: "Navigation may be stuck or suppressed",
    });
  }

  // 6. No handlers registered
  const noHandlersCount = lines.filter(l => l.includes("WebView2_NoHandlers")).length;
  if (noHandlersCount > 0) {
    issues.push({
      severity: "🟡 warning",
      message: `${noHandlersCount} event(s) fired with no handlers registered`,
      evidence: "WebView2_NoHandlers — events are being dropped because host hasn't registered handlers",
    });
  }

  // 7. Dropped events
  const droppedCount = lines.filter(l =>
    l.includes("WebView2_DroppedEvent") || l.includes("WebView2_NoEventDispatcher")).length;
  if (droppedCount > 0) {
    issues.push({
      severity: "🟡 warning",
      message: `${droppedCount} event(s) dropped`,
      evidence: "WebView2_DroppedEvent or WebView2_NoEventDispatcher",
    });
  }

  // 8. NavId mismatch
  if (lines.some(l => l.includes("WebView2_NavIdNotFound") || l.includes("WebView2_DifferentNavigationId"))) {
    issues.push({
      severity: "🟡 warning",
      message: "NavigationId mismatch or not found",
      evidence: "WebView2_NavIdNotFound or WebView2_DifferentNavigationId — events may target wrong navigation",
    });
  }

  // 9. DocState suppressed
  if (lines.some(l => l.includes("WebView2_DocStateSuppressed"))) {
    issues.push({
      severity: "🟡 warning",
      message: "Document state change was suppressed",
      evidence: "WebView2_DocStateSuppressed — likely about:blank initial navigation suppression",
    });
  }

  // 10. Auth/token issues
  const hasTokenFailure = lines.some(l =>
    l.includes("TokenBroker") && (l.includes("Failed") || l.includes("Error")));
  if (hasTokenFailure) {
    issues.push({
      severity: "🟡 warning",
      message: "Authentication token failure detected",
      evidence: "TokenBroker failure — may cause auth-related WebView2 issues",
    });
  }

  // 11. Errors per process
  for (const proc of processes) {
    if (proc.errors.length >= 3) {
      issues.push({
        severity: "🟡 warning",
        message: `Process ${proc.name} (PID ${proc.pid}) has ${proc.errors.length} errors`,
        evidence: proc.errors.slice(0, 3).join("; "),
      });
    }
  }

  // 12. Very short trace (might be incomplete)
  const timestamps = lines.map(l => extractTs(l)).filter((t): t is number => t !== null);
  if (timestamps.length > 10) {
    const spanMs = (Math.max(...timestamps) - Math.min(...timestamps)) / 1000;
    if (spanMs < 100) {
      issues.push({
        severity: "🔵 info",
        message: `Trace is very short (${spanMs.toFixed(0)}ms) — may be incomplete`,
        evidence: `Only ${timestamps.length} timestamped events in ${spanMs.toFixed(0)}ms`,
      });
    }
  }

  // 13. Large gaps (>2s)
  if (timestamps.length > 1) {
    timestamps.sort((a, b) => a - b);
    for (let i = 1; i < timestamps.length; i++) {
      const gapMs = (timestamps[i] - timestamps[i - 1]) / 1000;
      if (gapMs > 2000) {
        issues.push({
          severity: "🔵 info",
          message: `Large gap of ${(gapMs / 1000).toFixed(1)}s detected in trace`,
          evidence: `Gap between events at +${((timestamps[i - 1] - timestamps[0]) / 1000).toFixed(0)}ms and +${((timestamps[i] - timestamps[0]) / 1000).toFixed(0)}ms`,
        });
        break; // Only report the first large gap
      }
    }
  }

  return issues;
}

function formatIssues(issues: InitialIssue[]): string {
  if (issues.length === 0) return "✅ No issues detected in initial scan.";

  const out: string[] = [];
  const critical = issues.filter(i => i.severity.includes("critical"));
  const warnings = issues.filter(i => i.severity.includes("warning"));
  const info = issues.filter(i => i.severity.includes("info"));

  if (critical.length > 0) {
    out.push(`**${critical.length} critical issue(s):**`);
    for (const i of critical) {
      out.push(`- ${i.severity} **${i.message}**`);
      out.push(`  _${i.evidence}_`);
    }
    out.push("");
  }

  if (warnings.length > 0) {
    out.push(`**${warnings.length} warning(s):**`);
    for (const w of warnings) {
      out.push(`- ${w.severity} ${w.message}`);
      out.push(`  _${w.evidence}_`);
    }
    out.push("");
  }

  if (info.length > 0) {
    out.push(`**${info.length} informational:**`);
    for (const i of info) {
      out.push(`- ${i.severity} ${i.message}`);
    }
  }

  return out.join("\n");
}

// ─── Common helpers ─────────────────────────────────────────────────

function extractTs(line: string): number | null {
  const m = line.match(/,\s*(\d{5,})/);
  return m ? parseInt(m[1], 10) : null;
}

function extractEventName(line: string): string | null {
  const match = line.match(/^\s*(\S+?)[\s,\/]/);
  if (match) return match[1].replace(/[,\/]+$/, "");
  return null;
}
