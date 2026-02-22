/**
 * structured_report: Produces a 12-section structured JSON report from ETL analysis.
 *
 * Sections:
 *  1. Metadata           — ETL file info, versions, analysis window
 *  2. ProcessTopology    — Chromium process model (browser, renderers, GPU)
 *  3. NavigationTimeline — commit-level navigation tracking
 *  4. RenderingPipeline  — GPU/frame health signals
 *  5. StorageAndPartition — renderer lifecycle analysis
 *  6. NetworkActivity    — network request extraction
 *  7. InjectionAndEnvironment — DLL injection, VDI detection
 *  8. FailureSignals     — raw failure flags
 *  9. ComputedMetrics    — key timing deltas
 * 10. RootCauseAnalysis  — structured triage output
 * 11. ConfidenceModel    — confidence scoring
 * 12. Recommendations    — actionable guidance
 */

import { readFileSync, existsSync, statSync } from "fs";
import type { TraceStructure, Incarnation } from "./trace_structure.js";

// ─── Section Interfaces ─────────────────────────────────────────────

export interface ETLAnalysisReport {
  metadata: Metadata;
  processTopology: ProcessTopology;
  navigationTimeline: NavigationTimelineEntry[];
  renderingPipeline: RenderingPipeline;
  storageAndPartition: StorageAndPartition;
  networkActivity: NetworkActivity;
  injectionAndEnvironment: InjectionAndEnvironment;
  failureSignals: FailureSignals;
  computedMetrics: ComputedMetrics;
  rootCauseAnalysis: RootCauseAnalysis;
  confidenceModel: ConfidenceModel;
  recommendations: string[];
}

export interface Metadata {
  etlSizeMB: number | null;
  analysisWindow: { start: string; end: string } | null;
  browserVersion: string | null;
  runtimeVersion: string | null;
  sdkVersion: string | null;
  osBuild: string | null;
  symbolsLoaded: boolean;
  analysisMode: string;
  totalEvents: number;
  filteredEvents: number;
  traceSpanMs: number;
}

export interface ProcessTopology {
  browser: ProcessEntry | null;
  renderers: ProcessEntry[];
  gpu: ProcessEntry | null;
  utility: ProcessEntry[];
  host: ProcessEntry | null;
  crashpad: ProcessEntry[];
}

export interface ProcessEntry {
  pid: number;
  name: string;
  startTime: string | null;
  exitTime: string | null;
  exitCode: number | null;
  eventCount: number;
  errors: string[];
}

export interface NavigationTimelineEntry {
  navigationId: string | null;
  url: string | null;
  startTime: string | null;
  commitTime: string | null;
  completedTime: string | null;
  rendererPid: number | null;
  didCommit: boolean;
  didComplete: boolean;
  failureReason: string | null;
  durationMs: number | null;
}

export interface RenderingPipeline {
  gpuProcessHealthy: boolean;
  gpuProcessRestartCount: number;
  firstPresentTime: string | null;
  frameProducedAfterCommit: boolean;
  d3dDeviceResetDetected: boolean;
}

export interface StorageAndPartition {
  rendererRecreatedMidNavigation: boolean;
  multipleRendererForSameNav: boolean;
  storageContextResetLikely: boolean;
  rendererPidChanges: { fromPid: number; toPid: number; timestamp: string }[];
}

export interface NetworkActivity {
  requests: NetworkRequest[];
  longPendingRequests: number;
  maxRequestDurationMs: number | null;
}

export interface NetworkRequest {
  url: string | null;
  startTime: string | null;
  responseTime: string | null;
  status: number | null;
  durationMs: number | null;
}

export interface InjectionAndEnvironment {
  dllLoadCountBeforeRendererReady: number;
  thirdPartyDllsDetected: string[];
  imageLoadDurationMs: number | null;
  suspectedVDIEnvironment: boolean;
  vdiIndicators: string[];
}

export interface FailureSignals {
  rendererCrashDuringNavigation: boolean;
  gpuCrash: boolean;
  navigationCommitWithoutComplete: boolean;
  rendererStartupSlow: boolean;
  networkStallDetected: boolean;
  rendererRecreationDetected: boolean;
  browserProcessFailure: boolean;
  creationFailure: boolean;
  serviceWorkerTimeout: boolean;
  authenticationFailure: boolean;
}

export interface ComputedMetrics {
  browserToRendererStartupMs: number | null;
  navStartToCommitMs: number | null;
  commitToCompleteMs: number | null;
  rendererLifetimeMs: number | null;
  gpuRestartCount: number;
  dllLoadCount: number;
  creationTimeMs: number | null;
  firstNavigationTimeMs: number | null;
}

export interface RootCauseAnalysis {
  primary: RootCauseEntry | null;
  secondary: RootCauseEntry[];
}

export interface RootCauseEntry {
  type: string;
  subType: string;
  confidence: number;
  evidence: string[];
  missingSignals: string[];
  stage: string;
}

export interface ConfidenceModel {
  signalAgreementScore: number;
  temporalCorrelationScore: number;
  noiseLevelScore: number;
  finalConfidence: number;
}

// ─── Known VDI / third-party DLLs ───────────────────────────────────

const VDI_DLLS = [
  "ctxhook", "ctxmfplat", "ctxgfx", "picaapi", "picatwihost",   // Citrix
  "rdpbase", "rdpcorets", "rdpcorecd", "mstsc", "rdpclip",       // RDP
  "vmhgfs", "vmtools", "vmware",                                  // VMware
  "vdagent", "vdservice",                                         // Spice/KVM
];

const KNOWN_THIRD_PARTY_DLLS = [
  ...VDI_DLLS,
  "securityagent", "crowdstrike", "csfalcon", "csagent",          // CrowdStrike
  "cylance", "cyoptics",                                           // Cylance
  "sentinelagent", "sentinelone",                                  // SentinelOne
  "sophos", "savapi",                                              // Sophos
  "mcafee", "mfetp",                                               // McAfee
  "symantec", "norton",                                            // Symantec
  "carbon", "cbdefense",                                           // Carbon Black
  "zscaler", "zpa",                                                // Zscaler
  "netskope",                                                      // Netskope
];

// ─── Main Builder ───────────────────────────────────────────────────

export function buildStructuredReport(
  filteredFile: string,
  etlPath: string,
  hostApp: string,
  traceStructure: TraceStructure,
  triageResult: string,
  evidenceResult: string,
): ETLAnalysisReport {
  const lines = existsSync(filteredFile)
    ? readFileSync(filteredFile, "utf-8").split("\n").filter(l => l.trim())
    : [];

  let etlSizeMB: number | null = null;
  try {
    if (existsSync(etlPath)) {
      etlSizeMB = Math.round(statSync(etlPath).size / (1024 * 1024));
    }
  } catch { /* ignore */ }

  return {
    metadata: buildMetadata(etlPath, etlSizeMB, traceStructure, lines.length),
    processTopology: buildProcessTopology(traceStructure),
    navigationTimeline: buildNavigationTimeline(lines),
    renderingPipeline: buildRenderingPipeline(lines, traceStructure),
    storageAndPartition: buildStorageAndPartition(lines, traceStructure),
    networkActivity: buildNetworkActivity(lines),
    injectionAndEnvironment: buildInjectionAndEnvironment(lines, traceStructure),
    failureSignals: buildFailureSignals(lines, traceStructure, triageResult),
    computedMetrics: buildComputedMetrics(lines, traceStructure),
    rootCauseAnalysis: buildRootCauseAnalysis(triageResult),
    confidenceModel: buildConfidenceModel(triageResult, evidenceResult),
    recommendations: buildRecommendations(triageResult, evidenceResult, lines, traceStructure),
  };
}

// ─── Section Builders ───────────────────────────────────────────────

function buildMetadata(
  etlPath: string,
  etlSizeMB: number | null,
  ts: TraceStructure,
  filteredLineCount: number,
): Metadata {
  // Derive analysis window from first/last timestamp in trace
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  if (ts.traceSpanMs > 0) {
    windowStart = `0.000s`;
    windowEnd = `${(ts.traceSpanMs / 1000).toFixed(3)}s`;
  }

  // Detect OS build from command line args or environment info
  let osBuild: string | null = null;
  for (const arg of ts.config.environmentInfo) {
    const osMatch = arg.match(/Windows\s+\d+.*?(\d{5})/i);
    if (osMatch) { osBuild = arg.trim(); break; }
  }

  return {
    etlSizeMB,
    analysisWindow: windowStart && windowEnd ? { start: windowStart, end: windowEnd } : null,
    browserVersion: ts.config.browserVersion,
    runtimeVersion: ts.config.runtimeVersion,
    sdkVersion: ts.config.sdkVersion,
    osBuild,
    symbolsLoaded: false,
    analysisMode: "WebView2Focused",
    totalEvents: ts.totalEvents,
    filteredEvents: filteredLineCount,
    traceSpanMs: ts.traceSpanMs,
  };
}

function buildProcessTopology(ts: TraceStructure): ProcessTopology {
  const toEntry = (p: typeof ts.processes[0]): ProcessEntry => ({
    pid: p.pid,
    name: p.name,
    startTime: p.firstTs > 0 ? `${(p.firstTs / 1_000_000).toFixed(3)}s` : null,
    exitTime: p.lastTs > 0 ? `${(p.lastTs / 1_000_000).toFixed(3)}s` : null,
    exitCode: null, // not available from current extraction
    eventCount: p.eventCount,
    errors: p.errors,
  });

  return {
    browser: ts.processes.find(p => p.role === "browser" || p.role === "webview2")
      ? toEntry(ts.processes.find(p => p.role === "browser" || p.role === "webview2")!)
      : null,
    renderers: ts.processes.filter(p => p.role === "renderer").map(toEntry),
    gpu: ts.processes.find(p => p.role === "gpu") ? toEntry(ts.processes.find(p => p.role === "gpu")!) : null,
    utility: ts.processes.filter(p => p.role === "utility").map(toEntry),
    host: ts.processes.find(p => p.role === "host") ? toEntry(ts.processes.find(p => p.role === "host")!) : null,
    crashpad: ts.processes.filter(p => p.role === "crashpad").map(toEntry),
  };
}

function buildNavigationTimeline(lines: string[]): NavigationTimelineEntry[] {
  const navs: Map<string, NavigationTimelineEntry> = new Map();

  // Navigation lifecycle patterns
  for (const line of lines) {
    const lineLower = line.toLowerCase();

    // Extract NavigationId from various patterns
    let navId: string | null = null;
    const navIdMatch = line.match(/NavigationId[=:]\s*(\d+)/i)
      || line.match(/navigation_id[=:]\s*(\d+)/i);
    if (navIdMatch) navId = navIdMatch[1];

    // Detect navigation start
    if (lineLower.includes("webview2_navigationstarting") || lineLower.includes("navigationrequest") && lineLower.includes("create")) {
      const key = navId || `nav_${navs.size + 1}`;
      if (!navs.has(key)) {
        navs.set(key, {
          navigationId: navId,
          url: extractUrl(line),
          startTime: extractTimestamp(line),
          commitTime: null,
          completedTime: null,
          rendererPid: extractPid(line),
          didCommit: false,
          didComplete: false,
          failureReason: null,
          durationMs: null,
        });
      }
    }

    // Detect commit
    if (navId && (lineLower.includes("commitnavigation") || lineLower.includes("didcommitnavigation"))) {
      const nav = navs.get(navId);
      if (nav) {
        nav.commitTime = extractTimestamp(line);
        nav.didCommit = true;
        const rendPid = extractRendererPid(line);
        if (rendPid) nav.rendererPid = rendPid;
      }
    }

    // Detect completion
    if (navId && (lineLower.includes("navigationcompleted") || lineLower.includes("webview2_event_navigationcompletedhandler"))) {
      const nav = navs.get(navId);
      if (nav) {
        nav.completedTime = extractTimestamp(line);
        nav.didComplete = true;
      }
    }

    // Detect failure
    if (navId && (lineLower.includes("onrequestfailed") || lineLower.includes("navigationfailed"))) {
      const nav = navs.get(navId);
      if (nav) {
        nav.failureReason = extractFailureReason(line);
      }
    }
  }

  // Compute durations
  for (const nav of navs.values()) {
    if (nav.startTime && nav.completedTime) {
      const startUs = parseTimestampUs(nav.startTime);
      const endUs = parseTimestampUs(nav.completedTime);
      if (startUs !== null && endUs !== null) {
        nav.durationMs = (endUs - startUs) / 1000;
      }
    }
  }

  return Array.from(navs.values());
}

function buildRenderingPipeline(lines: string[], ts: TraceStructure): RenderingPipeline {
  const gpuProcs = ts.processes.filter(p => p.role === "gpu");
  let gpuCrash = false;
  let d3dReset = false;
  let firstPresent: string | null = null;
  let frameProduced = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("gpu") && (lower.includes("crash") || lower.includes("lost") || lower.includes("device removed"))) {
      gpuCrash = true;
    }
    if (lower.includes("d3d") && (lower.includes("reset") || lower.includes("device removed") || lower.includes("device lost"))) {
      d3dReset = true;
    }
    if (lower.includes("present") && lower.includes("frame") && !firstPresent) {
      firstPresent = extractTimestamp(line);
      frameProduced = true;
    }
    if (lower.includes("compositorframe") || lower.includes("didproduceframe") || lower.includes("rendererframepresented")) {
      frameProduced = true;
    }
  }

  return {
    gpuProcessHealthy: !gpuCrash && gpuProcs.every(p => p.errors.length === 0),
    gpuProcessRestartCount: Math.max(0, gpuProcs.length - 1),
    firstPresentTime: firstPresent,
    frameProducedAfterCommit: frameProduced,
    d3dDeviceResetDetected: d3dReset,
  };
}

function buildStorageAndPartition(lines: string[], ts: TraceStructure): StorageAndPartition {
  const renderers = ts.processes.filter(p => p.role === "renderer");
  const rendererPidChanges: { fromPid: number; toPid: number; timestamp: string }[] = [];

  // Track renderer PID changes during navigations
  let lastRendererPid: number | null = null;
  for (const line of lines) {
    if (line.toLowerCase().includes("commitnavigation") || line.toLowerCase().includes("didcommitnavigation")) {
      const pid = extractRendererPid(line);
      if (pid && lastRendererPid && pid !== lastRendererPid) {
        rendererPidChanges.push({
          fromPid: lastRendererPid,
          toPid: pid,
          timestamp: extractTimestamp(line) || "unknown",
        });
      }
      if (pid) lastRendererPid = pid;
    }
  }

  // Detect renderer exit mid-navigation
  let rendererRecreated = rendererPidChanges.length > 0;
  let multipleRenderers = renderers.length > 1;

  return {
    rendererRecreatedMidNavigation: rendererRecreated,
    multipleRendererForSameNav: multipleRenderers && rendererPidChanges.length > 0,
    storageContextResetLikely: rendererRecreated,
    rendererPidChanges,
  };
}

function buildNetworkActivity(lines: string[]): NetworkActivity {
  const requests: NetworkRequest[] = [];
  const pendingRequests: Map<string, NetworkRequest> = new Map();

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Detect network request starts
    if (lower.includes("urlloader") || lower.includes("resourcerequest") ||
        (lower.includes("navigationrequest") && lower.includes("create"))) {
      const url = extractUrl(line);
      const ts = extractTimestamp(line);
      const key = url || `req_${pendingRequests.size}`;
      if (!pendingRequests.has(key)) {
        const req: NetworkRequest = {
          url,
          startTime: ts,
          responseTime: null,
          status: null,
          durationMs: null,
        };
        pendingRequests.set(key, req);
        requests.push(req);
      }
    }

    // Detect responses
    if (lower.includes("response") && (lower.includes("received") || lower.includes("complete"))) {
      const url = extractUrl(line);
      if (url && pendingRequests.has(url)) {
        const req = pendingRequests.get(url)!;
        req.responseTime = extractTimestamp(line);
        const statusMatch = line.match(/status[=:]\s*(\d{3})/i);
        if (statusMatch) req.status = parseInt(statusMatch[1], 10);
        if (req.startTime && req.responseTime) {
          const startUs = parseTimestampUs(req.startTime);
          const endUs = parseTimestampUs(req.responseTime);
          if (startUs !== null && endUs !== null) req.durationMs = (endUs - startUs) / 1000;
        }
      }
    }
  }

  const longPending = requests.filter(r => r.responseTime === null).length;
  const durations = requests.map(r => r.durationMs).filter((d): d is number => d !== null);
  const maxDuration = durations.length > 0 ? Math.max(...durations) : null;

  return {
    requests: requests.slice(0, 50), // cap at 50 for readability
    longPendingRequests: longPending,
    maxRequestDurationMs: maxDuration,
  };
}

function buildInjectionAndEnvironment(lines: string[], ts: TraceStructure): InjectionAndEnvironment {
  const thirdPartyDlls: Set<string> = new Set();
  let dllLoadCount = 0;
  let firstRendererTs: number | null = null;
  let lastDllLoadBeforeRenderer: number | null = null;
  const vdiIndicators: string[] = [];

  // Find first renderer event timestamp
  for (const p of ts.processes) {
    if (p.role === "renderer" && p.firstTs > 0) {
      if (firstRendererTs === null || p.firstTs < firstRendererTs) {
        firstRendererTs = p.firstTs;
      }
    }
  }

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Count DLL/Image loads
    if (lower.includes("image/load") || lower.includes("image/dcstart") || lower.includes("imageload")) {
      dllLoadCount++;
      const tsVal = extractTsUs(line);

      // Track loads before renderer is ready
      if (firstRendererTs === null || (tsVal !== null && tsVal < firstRendererTs)) {
        if (tsVal !== null) lastDllLoadBeforeRenderer = tsVal;
      }

      // Check for third-party DLLs
      const dllMatch = line.match(/FileName[=:]?\s*[^,]*?([^\\\/]+\.dll)/i)
        || line.match(/["']([^"']*\.dll)["']/i)
        || line.match(/\\([^\\]+\.dll)/i);
      if (dllMatch) {
        const dllName = dllMatch[1].toLowerCase().replace(".dll", "");
        for (const known of KNOWN_THIRD_PARTY_DLLS) {
          if (dllName.includes(known)) {
            thirdPartyDlls.add(dllMatch[1]);
            // Check VDI specifically
            for (const vdi of VDI_DLLS) {
              if (dllName.includes(vdi)) {
                vdiIndicators.push(dllMatch[1]);
              }
            }
          }
        }
      }
    }

    // Also check process names for VDI indicators
    if (lower.includes("picatwihost") || lower.includes("ctxsvc") || lower.includes("wfica")) {
      const pName = line.match(/(picatwihost|ctxsvc|wfica)\S*/i);
      if (pName) vdiIndicators.push(pName[0]);
    }
  }

  let imageLoadDurationMs: number | null = null;
  if (firstRendererTs !== null && lastDllLoadBeforeRenderer !== null) {
    // Rough heuristic: first DLL load to renderer ready
    const allTs = ts.processes
      .filter(p => p.role === "host" || p.role === "browser")
      .map(p => p.firstTs)
      .filter(t => t > 0);
    if (allTs.length > 0) {
      const earliest = Math.min(...allTs);
      imageLoadDurationMs = (firstRendererTs - earliest) / 1000;
    }
  }

  return {
    dllLoadCountBeforeRendererReady: dllLoadCount,
    thirdPartyDllsDetected: Array.from(thirdPartyDlls),
    imageLoadDurationMs,
    suspectedVDIEnvironment: vdiIndicators.length > 0,
    vdiIndicators: [...new Set(vdiIndicators)],
  };
}

function buildFailureSignals(lines: string[], ts: TraceStructure, triageResult: string): FailureSignals {
  const triageLower = triageResult.toLowerCase();
  const signals: FailureSignals = {
    rendererCrashDuringNavigation: false,
    gpuCrash: false,
    navigationCommitWithoutComplete: false,
    rendererStartupSlow: false,
    networkStallDetected: false,
    rendererRecreationDetected: false,
    browserProcessFailure: false,
    creationFailure: false,
    serviceWorkerTimeout: false,
    authenticationFailure: false,
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("webview2_browserprocessfailure") || lower.includes("browserprocessexited")) {
      signals.browserProcessFailure = true;
    }
    if (lower.includes("webview2_creationfailure")) {
      signals.creationFailure = true;
    }
    if (lower.includes("rendererunresponsive") || (lower.includes("renderer") && lower.includes("crash"))) {
      signals.rendererCrashDuringNavigation = true;
    }
    if (lower.includes("gpu") && (lower.includes("crash") || lower.includes("device lost"))) {
      signals.gpuCrash = true;
    }
    if (lower.includes("serviceworker") && lower.includes("timeout")) {
      signals.serviceWorkerTimeout = true;
    }
    if ((lower.includes("webtokenrequest") || lower.includes("tokenbroker")) && lower.includes("fail")) {
      signals.authenticationFailure = true;
    }
  }

  // Infer from triage
  if (triageLower.includes("commit") && triageLower.includes("without") && triageLower.includes("complete")) {
    signals.navigationCommitWithoutComplete = true;
  }
  if (triageLower.includes("renderer") && (triageLower.includes("slow") || triageLower.includes("delay"))) {
    signals.rendererStartupSlow = true;
  }
  if (triageLower.includes("network") && triageLower.includes("stall")) {
    signals.networkStallDetected = true;
  }

  // Check incarnations for renderer recreation
  for (const inc of ts.incarnations) {
    if (inc.hasIssue) {
      signals.rendererRecreationDetected = true;
    }
  }

  return signals;
}

function buildComputedMetrics(lines: string[], ts: TraceStructure): ComputedMetrics {
  let creationTimeMs: number | null = null;
  let firstNavTimeMs: number | null = null;
  let navStartToCommitMs: number | null = null;
  let commitToCompleteMs: number | null = null;
  let rendererLifetimeMs: number | null = null;
  let browserToRendererMs: number | null = null;

  // Extract timing from known metric events
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("webview2_creationtime")) {
      const m = line.match(/total_time_ms[=:]\s*([\d.]+)/i);
      if (m) creationTimeMs = parseFloat(m[1]);
    }
    if (lower.includes("webview2_firstnavigationtime")) {
      const m = line.match(/total_time_ms[=:]\s*([\d.]+)/i)
        || line.match(/time_ms[=:]\s*([\d.]+)/i);
      if (m) firstNavTimeMs = parseFloat(m[1]);
    }
    if (lower.includes("navigationtotal") || lower.includes("navigation_total")) {
      const m = line.match(/duration[_ms]*[=:]\s*([\d.]+)/i)
        || line.match(/ms[=:]\s*([\d.]+)/i);
      if (m && navStartToCommitMs === null) navStartToCommitMs = parseFloat(m[1]);
    }
    if (lower.includes("beginnavigationtocommit")) {
      const m = line.match(/duration[_ms]*[=:]\s*([\d.]+)/i)
        || line.match(/ms[=:]\s*([\d.]+)/i);
      if (m) navStartToCommitMs = parseFloat(m[1]);
    }
    if (lower.includes("committofinish") || lower.includes("committodidcommit")) {
      const m = line.match(/duration[_ms]*[=:]\s*([\d.]+)/i)
        || line.match(/ms[=:]\s*([\d.]+)/i);
      if (m) commitToCompleteMs = parseFloat(m[1]);
    }
  }

  // Compute renderer lifetime from process data
  const renderers = ts.processes.filter(p => p.role === "renderer");
  if (renderers.length > 0) {
    const r = renderers[0];
    if (r.firstTs > 0 && r.lastTs > 0) {
      rendererLifetimeMs = (r.lastTs - r.firstTs) / 1000;
    }
  }

  // Browser to renderer startup — only count renderers that started AFTER browser
  const browser = ts.processes.find(p => p.role === "browser" || p.role === "webview2");
  if (browser && renderers.length > 0) {
    const browserStart = browser.firstTs;
    // Find first renderer that started after the browser process
    const postBrowserRenderers = renderers.filter(r => r.firstTs > browserStart);
    if (browserStart > 0 && postBrowserRenderers.length > 0) {
      browserToRendererMs = (postBrowserRenderers[0].firstTs - browserStart) / 1000;
    }
  }

  // DLL count
  let dllCount = 0;
  for (const line of lines) {
    if (line.toLowerCase().includes("image/load") || line.toLowerCase().includes("imageload")) {
      dllCount++;
    }
  }

  return {
    browserToRendererStartupMs: browserToRendererMs,
    navStartToCommitMs,
    commitToCompleteMs,
    rendererLifetimeMs,
    gpuRestartCount: Math.max(0, ts.processes.filter(p => p.role === "gpu").length - 1),
    dllLoadCount: dllCount,
    creationTimeMs,
    firstNavigationTimeMs: firstNavTimeMs,
  };
}

function buildRootCauseAnalysis(triageResult: string): RootCauseAnalysis {
  const candidates = parseTriageCandidates(triageResult);

  return {
    primary: candidates.length > 0 ? candidates[0] : null,
    secondary: candidates.slice(1),
  };
}

function parseTriageCandidates(triageResult: string): RootCauseEntry[] {
  const entries: RootCauseEntry[] = [];
  const lines = triageResult.split("\n");

  let current: Partial<RootCauseEntry> | null = null;
  let inEvidence = false;
  let inMissing = false;

  for (const line of lines) {
    // Detect candidate headers: "**1. SomeCause** (70% confidence)" or "### #1: SomeCause (85%)"
    const headerMatch = line.match(/\*\*(\d+)\.\s*(.+?)\*\*\s*\((\d+)%/)
      || line.match(/###\s*#(\d+):\s*(.+?)\s*\((\d+)%/);
    if (headerMatch) {
      if (current && current.type) {
        entries.push(current as RootCauseEntry);
      }
      current = {
        type: headerMatch[2].trim(),
        subType: "",
        confidence: parseInt(headerMatch[3], 10) / 100,
        evidence: [],
        missingSignals: [],
        stage: "",
      };
      inEvidence = false;
      inMissing = false;

      // Parse "Category: X | Stage: Y" on same or next line
      const catMatch = line.match(/Category:\s*([^|]+)\|?\s*Stage:\s*(.+)/);
      if (catMatch) {
        current.subType = catMatch[1].trim();
        current.stage = catMatch[2].trim();
      }
      continue;
    }

    if (!current) continue;

    // Parse category/stage from next line
    const catLine = line.match(/Category:\s*([^|]+)\|?\s*Stage:\s*(.+)/);
    if (catLine) {
      current.subType = catLine[1].trim();
      current.stage = catLine[2].trim();
    }

    // Evidence section
    if (line.trim().startsWith("Evidence:")) {
      inEvidence = true; inMissing = false; continue;
    }
    if (line.trim().startsWith("Missing:")) {
      inMissing = true; inEvidence = false; continue;
    }
    // Stop collecting on new section headers
    if (line.startsWith("###") || line.startsWith("**") && line.match(/\*\*\d+\./)) {
      inEvidence = false; inMissing = false;
    }

    // Collect bullet items
    const bulletMatch = line.match(/^\s*[-•*]\s+(.+)/);
    if (bulletMatch) {
      const text = bulletMatch[1].replace(/[✅🚫🔍⚠️]/g, "").trim();
      if (inEvidence) current.evidence!.push(text);
      if (inMissing) current.missingSignals!.push(text);
    }
  }

  if (current && current.type) {
    entries.push(current as RootCauseEntry);
  }

  return entries;
}

function buildConfidenceModel(triageResult: string, evidenceResult: string): ConfidenceModel {
  // Extract confidence from evidence pack
  let finalConfidence = 0;
  const confMatch = evidenceResult.match(/confidence[:\s]*(\d+)%/i)
    || evidenceResult.match(/score[:\s]*(\d+)%/i);
  if (confMatch) finalConfidence = parseInt(confMatch[1], 10) / 100;

  // Extract from triage if evidence doesn't have it
  if (finalConfidence === 0) {
    const triageConf = triageResult.match(/(\d+)%/);
    if (triageConf) finalConfidence = parseInt(triageConf[1], 10) / 100;
  }

  // Compute sub-scores from evidence result
  let signalAgreement = 0.5;
  let temporalCorrelation = 0.5;
  let noiseLevel = 0.5;

  const evidenceLower = evidenceResult.toLowerCase();
  // Signal agreement: more evidence items = higher
  const evidenceCount = (evidenceResult.match(/[-•*]\s+/g) || []).length;
  signalAgreement = Math.min(0.95, 0.3 + evidenceCount * 0.05);

  // Temporal correlation: if timing anomalies mentioned, lower
  if (evidenceLower.includes("timing anomal") || evidenceLower.includes("timing mismatch")) {
    temporalCorrelation = 0.4;
  } else if (evidenceLower.includes("timing consistent") || evidenceLower.includes("expected range")) {
    temporalCorrelation = 0.9;
  } else {
    temporalCorrelation = 0.7;
  }

  // Noise level: counter-evidence presence lowers this
  if (evidenceLower.includes("counter-evidence") && evidenceLower.includes("none")) {
    noiseLevel = 0.9;
  } else if (evidenceLower.includes("counter-evidence")) {
    noiseLevel = 0.5;
  } else {
    noiseLevel = 0.75;
  }

  // Recompute final if not parsed
  if (finalConfidence === 0) {
    finalConfidence = (signalAgreement * 0.4 + temporalCorrelation * 0.35 + noiseLevel * 0.25);
  }

  return {
    signalAgreementScore: Math.round(signalAgreement * 100) / 100,
    temporalCorrelationScore: Math.round(temporalCorrelation * 100) / 100,
    noiseLevelScore: Math.round(noiseLevel * 100) / 100,
    finalConfidence: Math.round(finalConfidence * 100) / 100,
  };
}

function buildRecommendations(
  triageResult: string,
  evidenceResult: string,
  lines: string[],
  ts: TraceStructure,
): string[] {
  const recs: string[] = [];

  // Extract recommendations from triage "Next Actions" section
  const triageLines = triageResult.split("\n");
  let inNext = false;
  for (const line of triageLines) {
    if (line.includes("Next Action") || line.includes("▶️")) { inNext = true; continue; }
    if (inNext && line.match(/^\s*[-•*\d.]\s+(.+)/)) {
      recs.push(line.replace(/^\s*[-•*\d.]+\s+/, "").replace(/\*\*/g, "").trim());
    }
    if (inNext && (line.startsWith("##") || line.startsWith("---"))) inNext = false;
  }

  // If no next actions found, use top candidate labels as recommendations
  if (recs.length === 0) {
    const candidates = parseTriageCandidates(triageResult);
    for (const c of candidates) {
      recs.push(`Investigate: ${c.type} (${(c.confidence * 100).toFixed(0)}% confidence, stage: ${c.stage})`);
    }
  }

  // Extract recommendations from evidence pack
  const evLines = evidenceResult.split("\n");
  let inAlt = false;
  for (const line of evLines) {
    if (line.includes("Alternative") || line.includes("Recommendation")) { inAlt = true; continue; }
    if (inAlt && line.match(/^\s*[-•*\d.]\s+(.+)/)) {
      const rec = line.replace(/^\s*[-•*\d.]+\s+/, "").trim();
      if (!recs.includes(rec)) recs.push(rec);
    }
    if (inAlt && line.startsWith("#")) inAlt = false;
  }

  // Add contextual recommendations based on signals
  const hasVdi = lines.some(l => VDI_DLLS.some(d => l.toLowerCase().includes(d)));
  if (hasVdi && !recs.some(r => r.toLowerCase().includes("vdi"))) {
    recs.push("Test in clean environment without VDI/security agents to isolate injection delays");
  }

  if (ts.processes.filter(p => p.role === "renderer").length > 2 && !recs.some(r => r.toLowerCase().includes("renderer"))) {
    recs.push("Investigate multiple renderer processes — possible renderer crashes and recreation");
  }

  return recs.slice(0, 10); // cap at 10
}

// ─── Formatting ─────────────────────────────────────────────────────

export function formatStructuredReport(report: ETLAnalysisReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatStructuredReportMarkdown(report: ETLAnalysisReport): string {
  const out: string[] = [];
  const r = report;
  const rca = r.rootCauseAnalysis;
  const fs = r.failureSignals;
  const cm = r.computedMetrics;
  const conf = r.confidenceModel;
  const topo = r.processTopology;
  const inj = r.injectionAndEnvironment;
  const net = r.networkActivity;
  const rp = r.renderingPipeline;
  const sp = r.storageAndPartition;

  // ── Confidence label ──
  const confPct = Math.round(conf.finalConfidence * 100);
  const confLabel = confPct >= 80 ? "High" : confPct >= 50 ? "Moderate" : "Low";

  // ── Primary finding summary ──
  const primaryType = rca.primary?.type || "No strong root cause identified";
  const primaryStage = rca.primary?.stage || "";

  // ── Derive narrative finding ──
  const finding = deriveFindingNarrative(r);

  // ═══════════════════════════════════════════════════════════════════
  // 1️⃣  EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  out.push("# 📄 WebView2 ETL Analysis Report");
  out.push("");
  out.push("## 1️⃣ Executive Summary");
  out.push("");
  out.push(`**Primary Finding:**`);
  out.push(`${finding}`);
  out.push("");
  out.push(`**Confidence Level:** ${confLabel} (${confPct}%)`);
  out.push("");
  out.push("**Why this conclusion?**");
  if (rca.primary) {
    for (const ev of rca.primary.evidence.slice(0, 5)) {
      out.push(`- ${ev}`);
    }
    for (const ms of rca.primary.missingSignals.slice(0, 3)) {
      out.push(`- ⚠️ ${ms}`);
    }
  }
  // Add key failure signals as bullet points
  if (fs.rendererCrashDuringNavigation) out.push("- Renderer process crashed during navigation.");
  if (fs.navigationCommitWithoutComplete) out.push("- Navigation committed but never completed.");
  if (fs.gpuCrash) out.push("- GPU process crash detected.");
  if (!fs.gpuCrash && rp.gpuProcessHealthy) out.push("- No GPU failure detected.");
  if (fs.browserProcessFailure) out.push("- Browser process failure detected.");
  if (fs.rendererRecreationDetected) out.push("- Renderer was recreated (process instability).");
  if (fs.rendererStartupSlow) out.push("- Renderer startup was abnormally slow.");
  out.push("");

  // ═══════════════════════════════════════════════════════════════════
  // 2️⃣  CHRONOLOGICAL TIMELINE
  // ═══════════════════════════════════════════════════════════════════
  out.push("## 2️⃣ What Happened (Chronological Timeline)");
  out.push("");
  out.push("| Time | Event |");
  out.push("|------|-------|");

  // Build timeline from process topology + navigation
  const timeline: { tsUs: number; label: string }[] = [];

  // Host process
  if (topo.host) {
    const ts = parseTimeStr(topo.host.startTime);
    if (ts !== null) timeline.push({ tsUs: ts, label: `${topo.host.name} started (PID ${topo.host.pid}) — Host application` });
  }

  // Browser process
  if (topo.browser) {
    const ts = parseTimeStr(topo.browser.startTime);
    if (ts !== null) timeline.push({ tsUs: ts, label: `${topo.browser.name} started (PID ${topo.browser.pid}) — Browser process` });
    const te = parseTimeStr(topo.browser.exitTime);
    if (te !== null && topo.browser.errors.length > 0) {
      timeline.push({ tsUs: te, label: `Browser process exited (PID ${topo.browser.pid}) — ${topo.browser.errors.length} error(s)` });
    }
  }

  // First renderer
  if (topo.renderers.length > 0) {
    const first = topo.renderers[0];
    const ts = parseTimeStr(first.startTime);
    if (ts !== null) timeline.push({ tsUs: ts, label: `Renderer started (PID ${first.pid})` });
    const te = parseTimeStr(first.exitTime);
    if (te !== null) {
      const lifetime = cm.rendererLifetimeMs ? `${fmtMs(cm.rendererLifetimeMs)} lifetime` : "";
      timeline.push({ tsUs: te, label: `Renderer exited (PID ${first.pid})${lifetime ? " — " + lifetime : ""}` });
    }
  }

  // GPU
  if (topo.gpu) {
    const ts = parseTimeStr(topo.gpu.startTime);
    if (ts !== null) timeline.push({ tsUs: ts, label: `GPU process started (PID ${topo.gpu.pid})` });
  }

  // Navigation events
  for (const nav of r.navigationTimeline.slice(0, 5)) {
    if (nav.startTime) {
      const tsVal = parseInt(nav.startTime, 10);
      const urlNote = nav.url ? ` (${nav.url.substring(0, 60)}${nav.url.length > 60 ? "..." : ""})` : "";
      timeline.push({ tsUs: tsVal / 1_000_000, label: `Navigation started${urlNote}` });
    }
    if (nav.commitTime) {
      timeline.push({ tsUs: parseInt(nav.commitTime, 10) / 1_000_000, label: "Navigation committed" });
    }
    if (nav.completedTime) {
      timeline.push({ tsUs: parseInt(nav.completedTime, 10) / 1_000_000, label: "Navigation completed ✅" });
    }
    if (!nav.didComplete && nav.didCommit) {
      timeline.push({ tsUs: (parseInt(nav.commitTime || "0", 10) + 1) / 1_000_000, label: "NavigationCompleted event **not observed** ❌" });
    }
    if (nav.failureReason) {
      timeline.push({ tsUs: parseInt(nav.startTime || "0", 10) / 1_000_000 + 0.001, label: `Navigation failed: ${nav.failureReason}` });
    }
  }

  // WebView2 creation
  if (cm.creationTimeMs !== null) {
    timeline.push({ tsUs: 0, label: `WebView2 creation completed (${fmtMs(cm.creationTimeMs)})` });
  }

  // Sort and emit
  timeline.sort((a, b) => a.tsUs - b.tsUs);
  for (const entry of timeline.slice(0, 20)) {
    out.push(`| ${fmtTime(entry.tsUs)} | ${entry.label} |`);
  }
  out.push("");

  // Interpretation
  out.push("**Interpretation:**");
  out.push(deriveTimelineInterpretation(r));
  out.push("");

  // ═══════════════════════════════════════════════════════════════════
  // 3️⃣  KEY OBSERVATIONS
  // ═══════════════════════════════════════════════════════════════════
  out.push("## 3️⃣ Key Observations");
  out.push("");

  // ── Renderer Behavior ──
  out.push("### 🟡 Renderer Behavior");
  out.push("");
  const rendererCount = topo.renderers.length;
  const rendererWithErrors = topo.renderers.filter(p => p.errors.length > 0).length;
  if (cm.browserToRendererStartupMs !== null && cm.browserToRendererStartupMs > 0) {
    const slow = cm.browserToRendererStartupMs > 500;
    out.push(`- Renderer startup delay: **${fmtMs(cm.browserToRendererStartupMs)}** (expected < 500ms) ${slow ? "⚠️ **Slow**" : "✅"}`);
  }
  if (cm.rendererLifetimeMs !== null) {
    out.push(`- Renderer lifetime: **${fmtMs(cm.rendererLifetimeMs)}**`);
  }
  out.push(`- Renderer processes observed: **${rendererCount}**${rendererCount > 2 ? " ⚠️ Multiple restarts" : ""}`);
  if (sp.rendererRecreatedMidNavigation) {
    out.push(`- Renderer restarted mid-navigation: **Yes** (${sp.rendererPidChanges.length} PID changes)`);
  }
  if (rendererWithErrors > 0) {
    out.push(`- Renderers with errors: **${rendererWithErrors}**`);
  }
  if (fs.rendererCrashDuringNavigation) {
    out.push("- ❌ Renderer crashed during active navigation");
  }
  out.push("");
  if (rendererCount > 2 || sp.rendererRecreatedMidNavigation) {
    out.push("*This suggests instability during page execution.*");
  } else if (fs.rendererStartupSlow) {
    out.push("*Renderer startup is slower than expected, possibly due to environment factors.*");
  } else {
    out.push("*Renderer behavior appears normal.*");
  }
  out.push("");

  // ── GPU Health ──
  out.push("### 🟡 GPU Health");
  out.push("");
  if (rp.gpuProcessHealthy) {
    out.push("- GPU process remained **stable**.");
    out.push("- No device reset or crash events detected.");
    out.push("- No evidence of GPU-related rendering failure.");
    out.push("");
    out.push("*Conclusion: GPU is unlikely to be the cause of rendering issues.*");
  } else {
    out.push(`- GPU process health: **Unhealthy** ❌`);
    out.push(`- GPU restart count: **${rp.gpuProcessRestartCount}**`);
    if (rp.d3dDeviceResetDetected) out.push("- D3D device reset detected ⚠️");
    out.push("");
    out.push("*GPU instability may be contributing to rendering failures.*");
  }
  if (rp.firstPresentTime) {
    out.push(`- First frame presented: ${rp.firstPresentTime}`);
  }
  if (!rp.frameProducedAfterCommit) {
    out.push("- ⚠️ No frame produced after navigation commit");
  }
  out.push("");

  // ── DLL Injection / Environment ──
  out.push("### 🟡 DLL Injection / Environment");
  out.push("");
  out.push(`- **${inj.dllLoadCountBeforeRendererReady}** DLLs loaded before renderer ready.`);
  if (inj.thirdPartyDllsDetected.length > 0) {
    out.push(`- Third-party DLLs detected: **${inj.thirdPartyDllsDetected.length}**`);
    for (const dll of inj.thirdPartyDllsDetected.slice(0, 10)) {
      out.push(`  - \`${dll}\``);
    }
  } else {
    out.push("- No known third-party/security DLLs detected.");
  }
  if (inj.imageLoadDurationMs !== null && inj.imageLoadDurationMs > 1000) {
    out.push(`- Image load phase duration: **${fmtMs(inj.imageLoadDurationMs)}** ⚠️`);
  }
  if (inj.suspectedVDIEnvironment) {
    out.push(`- 🔴 **VDI environment suspected** — indicators: ${inj.vdiIndicators.join(", ")}`);
    out.push("");
    out.push("*This strongly suggests VDI environment, security software injection, or endpoint monitoring hooks.*");
  } else if (inj.dllLoadCountBeforeRendererReady > 100) {
    out.push("");
    out.push("*High DLL load count may indicate environmental overhead slowing startup.*");
  } else {
    out.push("");
    out.push("*Environment appears clean — no significant injection detected.*");
  }
  out.push("");

  // ── Network Activity ──
  out.push("### 🟡 Network Activity");
  out.push("");
  const totalReqs = net.requests.length;
  if (totalReqs === 0) {
    out.push("- No network requests captured in this trace window.");
  } else {
    out.push(`- Network requests observed: **${totalReqs}**`);
    out.push(`- Pending (no response): **${net.longPendingRequests}**`);
    if (net.maxRequestDurationMs !== null) {
      const slow = net.maxRequestDurationMs > 10000;
      out.push(`- Max request duration: **${fmtMs(net.maxRequestDurationMs)}** ${slow ? "⚠️ **Stall detected**" : "✅"}`);
    }
    // Show URLs if available
    const withUrl = net.requests.filter(r => r.url).slice(0, 3);
    if (withUrl.length > 0) {
      out.push("");
      for (const req of withUrl) {
        const status = req.status ? `→ ${req.status}` : "→ pending";
        out.push(`  - \`${req.url!.substring(0, 80)}\` ${status}`);
      }
    }
  }
  out.push("");
  if (fs.networkStallDetected) {
    out.push("*⚠️ Network stall detected — may be contributing to navigation delays.*");
  } else {
    out.push("*Network is not the root cause.*");
  }
  out.push("");

  // ═══════════════════════════════════════════════════════════════════
  // 4️⃣  ROOT CAUSE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════
  out.push("## 4️⃣ Root Cause Analysis");
  out.push("");

  if (rca.primary) {
    const pConfPct = Math.round(rca.primary.confidence * 100);
    out.push(`### 🟥 Primary Root Cause`);
    out.push("");
    out.push(`**${rca.primary.type}**`);
    if (rca.primary.stage) out.push(`Stage: ${rca.primary.stage}`);
    out.push("");
    out.push("**Supporting Evidence:**");
    for (const ev of rca.primary.evidence) {
      out.push(`- ${ev}`);
    }
    if (rca.primary.missingSignals.length > 0) {
      out.push("");
      out.push("**Missing Expected Signals:**");
      for (const ms of rca.primary.missingSignals) {
        out.push(`- ⚠️ ${ms}`);
      }
    }
    out.push("");
    out.push("**Impact:**");
    out.push(deriveImpactNarrative(r));
    out.push("");
  } else {
    out.push("No strong primary root cause identified. The trace may lack sufficient signal coverage.");
    out.push("");
  }

  // Secondary / contributing factors
  if (rca.secondary.length > 0) {
    for (const sec of rca.secondary) {
      const sPct = Math.round(sec.confidence * 100);
      out.push(`### 🟡 Contributing Factor: ${sec.type}`);
      out.push("");
      out.push("**Supporting Evidence:**");
      for (const ev of sec.evidence.slice(0, 4)) {
        out.push(`- ${ev}`);
      }
      out.push("");
      out.push(`*Confidence: ${sPct}% | Stage: ${sec.stage}*`);
      out.push("");
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5️⃣  METRICS SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  out.push("## 5️⃣ Metrics Summary");
  out.push("");
  out.push("| Metric | Observed | Expected | Status |");
  out.push("|--------|----------|----------|--------|");

  // Browser → Renderer
  if (cm.browserToRendererStartupMs !== null && cm.browserToRendererStartupMs > 0) {
    out.push(`| Browser → Renderer Startup | ${fmtMs(cm.browserToRendererStartupMs)} | < 500 ms | ${cm.browserToRendererStartupMs > 500 ? "⚠️ Slow" : "✅ Normal"} |`);
  }
  // WebView2 Creation
  if (cm.creationTimeMs !== null) {
    out.push(`| WebView2 Creation | ${fmtMs(cm.creationTimeMs)} | < 3000 ms | ${cm.creationTimeMs > 3000 ? "⚠️ Slow" : "✅ Normal"} |`);
  }
  // Nav Start → Commit
  if (cm.navStartToCommitMs !== null) {
    out.push(`| Navigation Start → Commit | ${fmtMs(cm.navStartToCommitMs)} | < 2000 ms | ${cm.navStartToCommitMs > 2000 ? "⚠️ Slow" : "✅ Normal"} |`);
  }
  // Commit → Complete
  if (cm.commitToCompleteMs !== null) {
    out.push(`| Commit → Complete | ${fmtMs(cm.commitToCompleteMs)} | < 2000 ms | ${cm.commitToCompleteMs > 2000 ? "⚠️ Slow" : "✅ Normal"} |`);
  } else if (fs.navigationCommitWithoutComplete) {
    out.push(`| Commit → Complete | Not observed | < 2000 ms | ❌ Failed |`);
  }
  // Renderer lifetime
  if (cm.rendererLifetimeMs !== null) {
    out.push(`| Renderer Lifetime | ${fmtMs(cm.rendererLifetimeMs)} | — | ${cm.rendererLifetimeMs < 5000 ? "⚠️ Short" : "ℹ️"} |`);
  }
  // Renderer restarts
  out.push(`| Renderer Processes | ${topo.renderers.length} | 1-3 | ${topo.renderers.length > 5 ? "⚠️ Abnormal" : "✅ Normal"} |`);
  // GPU restarts
  out.push(`| GPU Restarts | ${cm.gpuRestartCount} | 0 | ${cm.gpuRestartCount > 0 ? "⚠️ Abnormal" : "✅ Healthy"} |`);
  // DLL loads
  out.push(`| DLL Loads | ${cm.dllLoadCount} | < 50 | ${cm.dllLoadCount > 100 ? "⚠️ High" : "✅ Normal"} |`);
  out.push("");

  // ═══════════════════════════════════════════════════════════════════
  // 6️⃣  WHAT THIS MEANS
  // ═══════════════════════════════════════════════════════════════════
  out.push("## 6️⃣ What This Means for the Application");
  out.push("");
  out.push(deriveWhatThisMeans(r));
  out.push("");

  // ═══════════════════════════════════════════════════════════════════
  // 7️⃣  RECOMMENDED NEXT STEPS
  // ═══════════════════════════════════════════════════════════════════
  out.push("## 7️⃣ Recommended Next Steps");
  out.push("");
  const nextSteps = deriveNextSteps(r);
  for (let i = 0; i < nextSteps.length; i++) {
    out.push(`${i + 1}. ${nextSteps[i]}`);
  }
  out.push("");

  // ═══════════════════════════════════════════════════════════════════
  // APPENDIX: Raw JSON (collapsed)
  // ═══════════════════════════════════════════════════════════════════
  out.push("---");
  out.push("");
  out.push("<details>");
  out.push("<summary>📎 Raw Structured Data (JSON)</summary>");
  out.push("");
  out.push("```json");
  out.push(JSON.stringify(report, null, 2));
  out.push("```");
  out.push("</details>");

  return out.join("\n");
}

// ─── Narrative Helpers ──────────────────────────────────────────────

function deriveFindingNarrative(r: ETLAnalysisReport): string {
  const rca = r.rootCauseAnalysis;
  const fs = r.failureSignals;

  if (!rca.primary) return "No definitive root cause could be determined from this trace.";

  const type = rca.primary.type.toLowerCase();

  if (fs.rendererCrashDuringNavigation) {
    return "Renderer process crashed during navigation, leading to blank screen or content loss.";
  }
  if (fs.navigationCommitWithoutComplete && !fs.rendererCrashDuringNavigation) {
    return "Navigation committed successfully but NavigationCompleted was never received by the host application.";
  }
  if (type.includes("not received")) {
    return "NavigationCompleted event was not delivered to the host application, leaving the WebView2 in an incomplete navigation state.";
  }
  if (type.includes("service worker")) {
    return "Service worker cold activation introduced excessive delay, stalling the navigation pipeline.";
  }
  if (type.includes("deadlock") || type.includes("stuck")) {
    return "Host application deadlocked during WebView2 initialization, preventing navigation from starting.";
  }
  if (type.includes("handler registration") || type.includes("race")) {
    return "Event handler registration race condition — handlers were registered after the events had already fired.";
  }
  if (type.includes("renderer") && type.includes("unresponsive")) {
    return "Renderer process became unresponsive, preventing page rendering from completing.";
  }
  if (fs.browserProcessFailure) {
    return "WebView2 browser process failed unexpectedly, terminating all associated renderers.";
  }
  if (fs.creationFailure) {
    return "WebView2 creation failed — the control could not be initialized.";
  }
  return `${rca.primary.type} — detected during ${rca.primary.stage || "analysis"}.`;
}

function deriveTimelineInterpretation(r: ETLAnalysisReport): string {
  const fs = r.failureSignals;
  const rca = r.rootCauseAnalysis;
  const cm = r.computedMetrics;

  if (fs.rendererCrashDuringNavigation) {
    return "The page committed in the renderer but the renderer exited before completion. This explains the blank screen or content loss.";
  }
  if (fs.navigationCommitWithoutComplete) {
    const commitMs = cm.navStartToCommitMs ? ` Navigation took ${fmtMs(cm.navStartToCommitMs)} to commit.` : "";
    return `Navigation reached commit but the NavigationCompleted event was never fired.${commitMs} The host application is likely waiting for a callback that will never arrive.`;
  }
  if (fs.rendererStartupSlow) {
    const startup = cm.browserToRendererStartupMs ? ` (${fmtMs(cm.browserToRendererStartupMs)})` : "";
    return `Renderer startup was significantly delayed${startup}. Environmental factors (DLL injection, VDI) may be contributing.`;
  }
  if (fs.browserProcessFailure) {
    return "The WebView2 browser process terminated unexpectedly, causing all renderers to exit.";
  }
  return "The timeline shows the WebView2 lifecycle progressing through initialization and navigation. See root cause analysis for the identified issue.";
}

function deriveImpactNarrative(r: ETLAnalysisReport): string {
  const fs = r.failureSignals;
  const rca = r.rootCauseAnalysis;

  if (fs.rendererCrashDuringNavigation) {
    return "The page loaded partially, then the renderer terminated, resulting in blank content. The host application received no NavigationCompleted callback.";
  }
  if (fs.navigationCommitWithoutComplete) {
    return "The host application is stuck waiting for NavigationCompleted. The WebView2 control will not report the navigation as finished, potentially blocking the application's UI flow.";
  }
  if (fs.browserProcessFailure) {
    return "All WebView2 functionality was lost when the browser process terminated. The host application must re-create the WebView2 control.";
  }
  if (fs.rendererStartupSlow) {
    return "Users experience delayed page load or apparent hang during WebView2 initialization. The delay compounds with subsequent navigations.";
  }
  if (rca.primary) {
    return `This issue affects the ${rca.primary.stage || "WebView2"} pipeline and may cause visible UI disruption or application hang.`;
  }
  return "Impact assessment requires more trace data.";
}

function deriveWhatThisMeans(r: ETLAnalysisReport): string {
  const fs = r.failureSignals;
  const cm = r.computedMetrics;
  const rca = r.rootCauseAnalysis;
  const lines: string[] = [];

  // Opening context
  if (cm.creationTimeMs !== null) {
    lines.push(`The WebView2 control initialized in ${fmtMs(cm.creationTimeMs)} and navigation began.`);
  } else {
    lines.push("The WebView2 control initialized and navigation began.");
  }

  // What went wrong
  if (fs.rendererCrashDuringNavigation) {
    lines.push("However, the renderer process terminated shortly after committing the page.");
    lines.push("");
    lines.push("Because rendering happens inside the renderer process, its termination resulted in:");
    lines.push("- Blank WebView window");
    lines.push("- No NavigationCompleted callback");
    lines.push("- No GPU frame presentation");
    lines.push("");
    lines.push("**The root cause is process-level instability, not networking or GPU.**");
  } else if (fs.navigationCommitWithoutComplete) {
    lines.push("The navigation committed (the server responded and the page began rendering), but NavigationCompleted was never delivered to the host application.");
    lines.push("");
    lines.push("This typically means:");
    lines.push("- The page's JavaScript or sub-resources are preventing load completion");
    lines.push("- A service worker is intercepting and stalling the request");
    lines.push("- Or the host's event handler was registered too late (race condition)");
    lines.push("");
    lines.push("**The host application is likely blocked waiting for a callback that may never arrive.**");
  } else if (fs.browserProcessFailure) {
    lines.push("However, the WebView2 browser process terminated unexpectedly, taking all renderer processes with it.");
    lines.push("");
    lines.push("**The entire WebView2 session was lost. The host application must reinitialize.**");
  } else if (fs.rendererStartupSlow) {
    lines.push(`The renderer took ${cm.browserToRendererStartupMs ? fmtMs(cm.browserToRendererStartupMs) : "an unusually long time"} to start, significantly delaying the user-visible page load.`);
    if (r.injectionAndEnvironment.suspectedVDIEnvironment) {
      lines.push("");
      lines.push("**VDI environment detected — DLL injection is the likely cause of the delay.**");
    }
  } else if (rca.primary) {
    lines.push(`Analysis identified **${rca.primary.type}** as the primary issue (${rca.primary.stage}).`);
  } else {
    lines.push("No critical failure was detected in this trace. The WebView2 lifecycle completed normally.");
  }

  return lines.join("\n");
}

function deriveNextSteps(r: ETLAnalysisReport): string[] {
  const steps: string[] = [];
  const fs = r.failureSignals;
  const inj = r.injectionAndEnvironment;
  const topo = r.processTopology;

  if (fs.rendererCrashDuringNavigation) {
    steps.push("Check Windows Event Viewer for crash reports matching the renderer PID(s).");
    steps.push("Enable WebView2 verbose logging to capture renderer termination reason.");
  }
  if (inj.suspectedVDIEnvironment || inj.thirdPartyDllsDetected.length > 0) {
    steps.push("Test the same scenario in a clean machine without VDI or security software.");
    if (inj.thirdPartyDllsDetected.length > 0) {
      steps.push(`Investigate third-party DLL injection: ${inj.thirdPartyDllsDetected.slice(0, 3).map(d => "\`" + d + "\`").join(", ")}.`);
    }
    steps.push("Validate antivirus / endpoint security exclusions for WebView2 processes.");
  }
  if (fs.navigationCommitWithoutComplete) {
    steps.push("Verify event handler registration timing — ensure NavigationCompleted handler is registered before calling Navigate().");
    steps.push("Check if the page's service worker or JavaScript is preventing load completion.");
  }
  if (fs.rendererStartupSlow && inj.dllLoadCountBeforeRendererReady > 100) {
    steps.push("Temporarily disable third-party DLL injection (if possible) to measure baseline renderer startup time.");
  }
  if (fs.browserProcessFailure) {
    steps.push("Check browser process exit code and crash dumps in the WebView2 user data folder.");
    steps.push("Verify WebView2 Runtime version is up to date.");
  }
  if (fs.serviceWorkerTimeout) {
    steps.push("Profile the service worker — check for slow fetch handlers or cache misses.");
  }
  if (fs.authenticationFailure) {
    steps.push("Verify WAM/TokenBroker configuration and network connectivity to identity providers.");
  }
  if (topo.renderers.length > 5) {
    steps.push("Investigate renderer recycling — multiple renderer processes suggest page navigation instability or iframe issues.");
  }

  // Always include general steps
  if (steps.length === 0) {
    steps.push("Collect a new trace with WebView2 verbose logging enabled for deeper analysis.");
  }
  steps.push("Compare with a working trace using the `compare_etls` tool to identify divergence points.");

  // Add user-provided recommendations from triage/evidence
  for (const rec of r.recommendations.slice(0, 3)) {
    const clean = rec.replace(/\*\*/g, "").trim();
    if (!steps.some(s => s.includes(clean.substring(0, 30)))) {
      steps.push(clean);
    }
  }

  return steps.slice(0, 8);
}

// ─── Formatting Utilities ───────────────────────────────────────────

function fmtMs(ms: number): string {
  if (Math.abs(ms) >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)} ms`;
}

function fmtTime(seconds: number): string {
  if (seconds <= 0) return "0.000s";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  if (m > 0) return `${m}m ${s.toFixed(3)}s`;
  return `${s.toFixed(3)}s`;
}

function parseTimeStr(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/([\d.]+)s/);
  return m ? parseFloat(m[1]) : null;
}

// ─── Utility Helpers ────────────────────────────────────────────────

function extractTimestamp(line: string): string | null {
  const m = line.match(/,\s*(\d{5,})/);
  return m ? m[1] : null;
}

function extractTsUs(line: string): number | null {
  const m = line.match(/,\s*(\d{5,})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseTimestampUs(ts: string): number | null {
  const n = parseInt(ts, 10);
  return isNaN(n) ? null : n;
}

function extractPid(line: string): number | null {
  const m = line.match(/\w+\.exe\s*\((\d+)\)/);
  return m ? parseInt(m[1], 10) : null;
}

function extractRendererPid(line: string): number | null {
  const m = line.match(/msedgewebview2\.exe\s*\((\d+)\)/i);
  return m ? parseInt(m[1], 10) : null;
}

function extractUrl(line: string): string | null {
  const m = line.match(/https?:\/\/[^\s,;"']+/i);
  return m ? m[0] : null;
}

function extractFailureReason(line: string): string | null {
  const m = line.match(/error[=:]\s*([^,]+)/i)
    || line.match(/reason[=:]\s*([^,]+)/i)
    || line.match(/status[=:]\s*(\d+)/i);
  return m ? m[1].trim() : null;
}
