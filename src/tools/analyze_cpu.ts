import { existsSync, readFileSync } from "fs";
import { generatePreprocessStep } from "./etlx_cache.js";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

const SYMBOL_PATH = [
  "srv*C:\\Symbols*https://chromium-browser-symsrv.commondatastorage.googleapis.com",
  "srv*C:\\Symbols*http://msdl.microsoft.com/download/symbols",
  "srv*C:\\Symbols*https://microsoftedge.symweb.azurefd.net",
].join(";");

/**
 * Mode 1: Generate CPU analysis commands for an ETL (with symbols).
 * Mode 2: If a symbolized output file is provided, parse and summarize CPU time per keyword.
 */
export function analyzeCpu(
  etlPath: string,
  pid: string,
  keywords: string[],
  rangeStartUs?: string,
  rangeEndUs?: string,
  symbolizedFile?: string
): string {
  // Mode 2: Analyze already-extracted symbolized CPU data
  if (symbolizedFile) {
    if (!existsSync(symbolizedFile)) {
      return `❌ Symbolized file not found: ${symbolizedFile}. Run the extraction commands first.`;
    }
    return parseCpuData(symbolizedFile, keywords, pid);
  }

  // Mode 1: Generate extraction commands
  if (!existsSync(etlPath)) {
    return `❌ ETL file not found: ${etlPath}`;
  }

  const outDir = "C:\\temp\\cpu_analysis";
  const outFile = `${outDir}\\cpu_pid_${pid}.txt`;
  const lines: string[] = [
    `## CPU Trace Analysis — PID ${pid}`,
    "",
    `**Keywords**: ${keywords.map(k => `\`${k}\``).join(", ")}`,
    "",
    "### Symbol Servers",
    "| Server | Resolves |",
    "|--------|----------|",
    "| `chromium-browser-symsrv` | Open-source Chromium binaries |",
    "| `msdl.microsoft.com` | Windows OS binaries (ntdll, kernel32) |",
    "| `microsoftedge.symweb.azurefd.net` | Edge internals (msedge.dll) — requires corpnet |",
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
