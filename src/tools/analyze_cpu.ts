import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { generatePreprocessStep } from "./etlx_cache.js";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

const SYMBOL_PATH = [
  "srv*C:\\Symbols*https://chromium-browser-symsrv.commondatastorage.googleapis.com",
  "srv*C:\\Symbols*http://msdl.microsoft.com/download/symbols",
  "srv*C:\\Symbols*https://symweb.azurefd.net",
].join(";");

// TraceEvent/TraceProcessor-based extractor
function getEtlExtractPath(): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(thisDir, "..", "..", "tools", "etl-extract", "bin", "EtlExtract.exe"),
    join(thisDir, "..", "tools", "etl-extract", "bin", "EtlExtract.exe"),
    join(homedir(), "source", "webview2-etw-mcp-server", "tools", "etl-extract", "bin", "EtlExtract.exe"),
    "C:\\temp\\webview2-etw-mcp-server\\tools\\etl-extract\\bin\\EtlExtract.exe",
    join(thisDir, "..", "..", "tools", "etl-extract", "EtlExtract", "bin", "Release", "net10.0", "win-x64", "EtlExtract.exe"),
    // Debug build location
    join(thisDir, "..", "..", "tools", "etl-extract", "EtlExtract", "bin", "Release", "net10.0", "EtlExtract.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface CpuJsonSummary {
  totalSamples: number;
  totalProcessed: number;
  pid: number;
  rangeUs: [number, number];
  elapsedSec: number;
  symbolPath: string;
  rawSamplesFile: string;
  topFunctions: { name: string; samples: number }[];
  topModules: { name: string; samples: number; pct: number }[];
  keywordHits: { keyword: string; samples: number; pct: number }[];
  skippedByPid: number;
  skippedByRange: number;
}

/**
 * CPU analysis using native TraceProcessor extraction (fast) or xperf fallback (slow).
 *
 * Mode 1 (native): EtlExtract --cpu does single-pass extraction with symbol resolution.
 * Mode 2 (legacy): Generates xperf shell commands for manual execution.
 * Mode 3 (parse):  If symbolizedFile is provided, parses pre-extracted data.
 */
export function analyzeCpu(
  etlPath: string,
  pid: string,
  keywords: string[],
  rangeStartUs?: string,
  rangeEndUs?: string,
  symbolizedFile?: string
): string {
  // Mode 3: Analyze already-extracted symbolized CPU data (backward compat)
  if (symbolizedFile) {
    // Check if it's a JSON summary from native extraction
    if (symbolizedFile.endsWith(".json") && existsSync(symbolizedFile)) {
      return formatJsonSummary(symbolizedFile, keywords, pid);
    }
    if (!existsSync(symbolizedFile)) {
      return `❌ Symbolized file not found: ${symbolizedFile}. Run the extraction commands first.`;
    }
    return parseCpuData(symbolizedFile, keywords, pid);
  }

  if (!existsSync(etlPath)) {
    return `❌ ETL file not found: ${etlPath}`;
  }

  // Mode 1: Native extraction via EtlExtract --cpu (fast, single-pass)
  const etlExtractPath = getEtlExtractPath();
  if (etlExtractPath) {
    return nativeCpuExtraction(etlExtractPath, etlPath, pid, keywords, rangeStartUs, rangeEndUs);
  }

  // Mode 2: Legacy xperf fallback (slow, generates commands)
  return legacyXperfCommands(etlPath, pid, keywords, rangeStartUs, rangeEndUs);
}

/**
 * Native CPU extraction using EtlExtract --cpu (TraceProcessor).
 * Runs synchronously — typically completes in 15-60 seconds.
 */
function nativeCpuExtraction(
  extractPath: string,
  etlPath: string,
  pid: string,
  keywords: string[],
  rangeStartUs?: string,
  rangeEndUs?: string
): string {
  const outDir = "C:\\temp\\cpu_analysis";
  const outputPath = `${outDir}\\cpu_pid_${pid}.json`;

  const args = [
    `"${extractPath}"`,
    `"${etlPath}"`,
    `"_"`,       // hostApp placeholder (not used in --cpu mode for filtering)
    "--cpu",
    "--pid", pid,
    "--keywords", keywords.join(","),
    "--output", `"${outputPath}"`,
  ];

  if (rangeStartUs) args.push("--range-start", rangeStartUs);
  if (rangeEndUs) args.push("--range-end", rangeEndUs);

  const sections: string[] = [
    `## CPU Analysis — PID ${pid} (native TraceProcessor)`,
    "",
    `**Keywords**: ${keywords.map(k => `\`${k}\``).join(", ")}`,
  ];

  if (rangeStartUs && rangeEndUs) {
    sections.push(`**Time range**: ${rangeStartUs}–${rangeEndUs} µs`);
  }
  sections.push("");

  try {
    const cmd = args.join(" ");
    sections.push("Running native CPU extraction (TraceProcessor + symbol resolution)...");
    sections.push("");

    const result = execSync(cmd, {
      timeout: 300_000, // 5 min max
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        _NT_SYMBOL_PATH: process.env._NT_SYMBOL_PATH || SYMBOL_PATH,
      },
    });

    // Parse stdout for CPU_OK line
    const okLine = result.split("\n").find(l => l.startsWith("CPU_OK|"));
    if (!okLine) {
      sections.push("⚠️ Extraction completed but no summary line found.");
      sections.push(`Check output at: \`${outputPath}\``);
      return sections.join("\n");
    }

    const [, matchedStr, totalStr, elapsedStr, outPath] = okLine.split("|");
    sections.push(`✅ **Extraction complete** in ${elapsedStr}s — ${parseInt(matchedStr).toLocaleString()} samples from ${parseInt(totalStr).toLocaleString()} total`);
    sections.push("");

    // Read and format the JSON summary
    if (existsSync(outputPath)) {
      sections.push(formatJsonSummary(outputPath, keywords, pid));
    }

    return sections.join("\n");
  } catch (err: any) {
    // If native extraction fails, fall back to xperf commands
    const stderr = err.stderr?.toString() || err.message || "Unknown error";
    sections.push(`⚠️ Native extraction failed: ${stderr.split("\n")[0]}`);
    sections.push("");
    sections.push("Falling back to xperf-based extraction commands:");
    sections.push("");
    sections.push(legacyXperfCommands(etlPath, pid, keywords, rangeStartUs, rangeEndUs));
    return sections.join("\n");
  }
}

/**
 * Format a JSON summary from native EtlExtract --cpu output into markdown.
 */
function formatJsonSummary(jsonPath: string, keywords: string[], pid: string): string {
  const summary: CpuJsonSummary = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const result: string[] = [];

  result.push(`## CPU Analysis Results — PID ${pid || summary.pid || "all"}`);
  result.push("");
  result.push(`**Source**: \`${jsonPath}\``);
  result.push(`**Total CPU samples**: ${summary.totalSamples.toLocaleString()} (~${summary.totalSamples}ms CPU time at 1ms sampling)`);
  result.push(`**Extraction time**: ${summary.elapsedSec}s`);
  if (summary.skippedByPid > 0) result.push(`**Skipped (other PIDs)**: ${summary.skippedByPid.toLocaleString()}`);
  if (summary.skippedByRange > 0) result.push(`**Skipped (outside range)**: ${summary.skippedByRange.toLocaleString()}`);
  result.push("");

  // Keyword hits
  if (summary.keywordHits?.length > 0) {
    result.push("### CPU Time by Keyword");
    result.push("| Keyword | Samples | ~CPU Time | % of Total |");
    result.push("|---------|---------|-----------|------------|");
    for (const kh of summary.keywordHits) {
      result.push(`| \`${kh.keyword}\` | ${kh.samples.toLocaleString()} | ~${kh.samples}ms | ${kh.pct}% |`);
    }
    result.push("");
  }

  // Top functions
  if (summary.topFunctions?.length > 0) {
    result.push("### Top Functions by CPU Time");
    result.push("| Rank | Samples | ~CPU ms | Function |");
    result.push("|------|---------|---------|----------|");
    summary.topFunctions.forEach((fn, i) => {
      result.push(`| ${i + 1} | ${fn.samples.toLocaleString()} | ~${fn.samples}ms | \`${fn.name}\` |`);
    });
    result.push("");
  }

  // Top modules
  if (summary.topModules?.length > 0) {
    result.push("### CPU Time by Module");
    result.push("| Module | Samples | ~CPU ms | % |");
    result.push("|--------|---------|---------|---|");
    for (const mod of summary.topModules) {
      result.push(`| \`${mod.name}\` | ${mod.samples.toLocaleString()} | ~${mod.samples}ms | ${mod.pct}% |`);
    }
    result.push("");
  }

  // Raw samples file reference
  if (summary.rawSamplesFile) {
    result.push(`📄 Raw samples: \`${summary.rawSamplesFile}\``);
    result.push("");
  }

  // Next steps
  result.push("### 📋 Next Steps");
  const topKw = summary.keywordHits?.sort((a, b) => b.samples - a.samples)?.[0];
  if (topKw && topKw.samples > 0) {
    result.push(`1. **\`${topKw.keyword}\`** dominates CPU at ${topKw.pct}% — investigate functions in this module`);
  }
  result.push(`2. Use \`diagnose\` if a pattern matches known symptoms`);
  result.push(`3. Use \`timeline_slice\` to correlate CPU hotspots with ETW events`);
  result.push(`4. Compare with a known-good trace to identify regressions`);

  return result.join("\n");
}

/**
 * Legacy xperf-based CPU extraction (generates PowerShell commands for manual execution).
 */
function legacyXperfCommands(
  etlPath: string,
  pid: string,
  keywords: string[],
  rangeStartUs?: string,
  rangeEndUs?: string
): string {
  const outDir = "C:\\temp\\cpu_analysis";
  const outFile = `${outDir}\\cpu_pid_${pid}.txt`;
  const lines: string[] = [
    `## CPU Trace Analysis — PID ${pid} (xperf legacy mode)`,
    "",
    "⚠️ **This uses xperf text dumping which is slow (5-30+ min).** Build the native extractor for 10-60x speedup:",
    "```",
    "cd tools/etl-extract/EtlExtract && dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ../bin",
    "```",
    "",
    `**Keywords**: ${keywords.map(k => `\`${k}\``).join(", ")}`,
    "",
    "### Symbol Servers",
    "| Server | Resolves |",
    "|--------|----------|",
    "| `chromium-browser-symsrv` | Open-source Chromium binaries |",
    "| `msdl.microsoft.com` | Windows OS binaries (ntdll, kernel32) |",
    "| `symweb.azurefd.net` | Edge internals (msedge.dll) — requires corpnet |",
    "",
    "### Step 1: Set Variables",
    "```powershell",
    `$xperf = "${XPERF_PATH}"`,
    `$etl = "${etlPath}"`,
    `$pid = "${pid}"`,
    `$outDir = "${outDir}"`,
    `New-Item -ItemType Directory -Path $outDir -Force | Out-Null`,
    `$env:_NT_SYMBOL_PATH = "${SYMBOL_PATH}"`,
    "```",
    "",
    ...generatePreprocessStep("$etl", outDir),
  ];

  if (rangeStartUs && rangeEndUs) {
    lines.push(
      `### Step 2: Extract CPU Samples (PID ${pid}, range ${rangeStartUs}–${rangeEndUs} µs)`,
      "```powershell",
      `Write-Host "Extracting CPU samples with symbols (may take 5-15 min for 1s range)..."`,
      `& $xperf -i $etl -symbols -a dumper -range ${rangeStartUs} ${rangeEndUs} 2>$null |`,
      `  Select-String -Pattern "SampledProfile.*\\($pid\\)" |`,
      `  Out-File "${outFile}" -Encoding utf8`,
      `$count = (Get-Content "${outFile}" | Measure-Object).Count`,
      `Write-Host "Done: $count CPU samples for PID $pid"`,
      "```",
    );
  } else {
    lines.push(
      `### Step 2: Extract ALL CPU Samples for PID ${pid}`,
      "⚠️ **Without a time range, this scans the entire trace and can take 30+ minutes.**",
      "Consider narrowing with `timeline_slice` first to find the interesting time window.",
      "",
      "```powershell",
      `Write-Host "Extracting CPU samples with symbols..."`,
      `& $xperf -i $etl -symbols -a dumper 2>$null |`,
      `  Select-String -Pattern "SampledProfile.*\\($pid\\)" |`,
      `  Out-File "${outFile}" -Encoding utf8`,
      `$count = (Get-Content "${outFile}" | Measure-Object).Count`,
      `Write-Host "Done: $count CPU samples for PID $pid"`,
      "```",
    );
  }

  lines.push(
    "",
    `### Step 3: Quick Keyword Scan`,
    "```powershell",
    `$keywords = @(${keywords.map(k => `"${k}"`).join(", ")})`,
    `foreach ($kw in $keywords) {`,
    `  $hits = (Select-String -Path "${outFile}" -Pattern $kw | Measure-Object).Count`,
    `  Write-Host "$kw : $hits samples (~$($hits)ms CPU time at 1ms sampling)"`,
    `}`,
    "```",
    "",
    "### Step 4: Top Functions by CPU Time",
    "```powershell",
    `# Extract function names from stack frames and count`,
    `Get-Content "${outFile}" |`,
    `  ForEach-Object { if ($_ -match '\\+0x[0-9a-f]+\\s+(\\S+!\\S+)') { $matches[1] } } |`,
    `  Group-Object | Sort-Object Count -Descending | Select-Object -First 20 |`,
    `  Format-Table @{N='Samples';E={$_.Count}}, @{N='~CPU ms';E={$_.Count}}, @{N='Function';E={$_.Name}}`,
    "```",
    "",
    "### Step 5: Analyze Results",
    `After running the commands, ask Copilot:`,
    "",
    `> *"Analyze the CPU data at ${outFile} for PID ${pid}, keywords: ${keywords.join(", ")}"*`,
    "",
    "This will parse the symbolized output and show:",
    "- CPU time per keyword (in ms, based on 1ms sampling)",
    "- Top functions consuming CPU",
    "- Module breakdown",
    "- Keyword co-occurrence in call stacks",
  );

  return lines.join("\n");
}

function parseCpuData(filePath: string, keywords: string[], pid: string): string {
  const content = readFileSync(filePath, "utf-8");
  const allLines = content.split("\n").filter(l => l.trim().length > 0);

  // Filter to target PID if specified
  const lines = pid
    ? allLines.filter(l => l.includes(`(${pid})`))
    : allLines;

  const totalSamples = lines.length;

  if (totalSamples === 0) {
    return `❌ No CPU samples found${pid ? ` for PID ${pid}` : ""} in ${filePath}. Check that the extraction ran correctly.`;
  }

  const result: string[] = [
    `## CPU Analysis Results — PID ${pid || "all"}`,
    "",
    `**Source**: \`${filePath}\``,
    `**Total CPU samples**: ${totalSamples.toLocaleString()} (~${totalSamples}ms CPU time at 1ms sampling)`,
    "",
  ];

  // Keyword hit counts
  result.push("### CPU Time by Keyword");
  result.push("| Keyword | Samples | ~CPU Time | % of Total |");
  result.push("|---------|---------|-----------|------------|");

  const keywordHits: { keyword: string; count: number; lines: string[] }[] = [];
  for (const kw of keywords) {
    const matching = lines.filter(l => l.toLowerCase().includes(kw.toLowerCase()));
    keywordHits.push({ keyword: kw, count: matching.length, lines: matching });
    const pct = totalSamples > 0 ? ((matching.length / totalSamples) * 100).toFixed(1) : "0";
    result.push(`| \`${kw}\` | ${matching.length.toLocaleString()} | ~${matching.length}ms | ${pct}% |`);
  }

  const unmatchedCount = lines.filter(l => !keywords.some(kw => l.toLowerCase().includes(kw.toLowerCase()))).length;
  if (unmatchedCount > 0) {
    const pct = ((unmatchedCount / totalSamples) * 100).toFixed(1);
    result.push(`| *(other)* | ${unmatchedCount.toLocaleString()} | ~${unmatchedCount}ms | ${pct}% |`);
  }
  result.push("");

  // Top functions across all samples
  const funcCounts = new Map<string, number>();
  for (const line of lines) {
    const funcMatch = line.match(/\+0x[0-9a-f]+\s+(\S+!\S+)/i);
    if (funcMatch) {
      const fn = funcMatch[1];
      funcCounts.set(fn, (funcCounts.get(fn) || 0) + 1);
    }
  }

  if (funcCounts.size > 0) {
    const topFuncs = Array.from(funcCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    result.push("### Top Functions by CPU Time");
    result.push("| Rank | Samples | ~CPU ms | Function |");
    result.push("|------|---------|---------|----------|");
    topFuncs.forEach(([fn, count], i) => {
      result.push(`| ${i + 1} | ${count} | ~${count}ms | \`${fn}\` |`);
    });
    result.push("");
  }

  // Module breakdown
  const moduleCounts = new Map<string, number>();
  for (const line of lines) {
    const modMatch = line.match(/\+0x[0-9a-f]+\s+(\S+)!/i);
    if (modMatch) {
      const mod = modMatch[1].toLowerCase();
      moduleCounts.set(mod, (moduleCounts.get(mod) || 0) + 1);
    }
  }

  if (moduleCounts.size > 0) {
    const topMods = Array.from(moduleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    result.push("### CPU Time by Module");
    result.push("| Module | Samples | ~CPU ms | % |");
    result.push("|--------|---------|---------|---|");
    for (const [mod, count] of topMods) {
      const pct = ((count / totalSamples) * 100).toFixed(1);
      result.push(`| \`${mod}\` | ${count} | ~${count}ms | ${pct}% |`);
    }
    result.push("");
  }

  // Keyword co-occurrence (which keywords appear together in same stack frame lines)
  if (keywords.length > 1) {
    result.push("### Keyword Co-occurrence");
    result.push("Samples where multiple keywords appear in the same call stack:");
    result.push("");
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const both = lines.filter(
          l => l.toLowerCase().includes(keywords[i].toLowerCase()) &&
               l.toLowerCase().includes(keywords[j].toLowerCase())
        ).length;
        if (both > 0) {
          result.push(`- \`${keywords[i]}\` + \`${keywords[j]}\`: ${both} samples`);
        }
      }
    }
    result.push("");
  }

  // Recommendations
  result.push("### 📋 Next Steps");
  const topKeyword = keywordHits.sort((a, b) => b.count - a.count)[0];
  if (topKeyword && topKeyword.count > 0) {
    result.push(`1. **\`${topKeyword.keyword}\`** dominates CPU at ${((topKeyword.count/totalSamples)*100).toFixed(0)}% — investigate functions in this module`);
  }
  if (unmatchedCount > totalSamples * 0.5) {
    result.push(`2. ${((unmatchedCount/totalSamples)*100).toFixed(0)}% of CPU is NOT in any keyword — may need broader keyword search`);
  }
  result.push(`3. Use \`diagnose\` if a pattern matches known symptoms`);
  result.push(`4. Use \`timeline_slice\` to correlate CPU hotspots with ETW events`);

  return result.join("\n");
}
