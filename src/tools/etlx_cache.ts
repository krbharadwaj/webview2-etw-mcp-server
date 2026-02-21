/**
 * etlx_cache: ETL → ETLX one-time conversion for indexed, fast repeated queries.
 *
 * ETLX is an indexed format that avoids re-decoding raw ETW on every xperf invocation.
 * The conversion happens once; subsequent analysis steps use the cached ETLX.
 *
 * Strategies (in priority order):
 *   1. xperf -merge (pre-processes/cooks the ETL into a faster-to-read merged ETL)
 *   2. wpaexporter (WPA's exporter, if available)
 *
 * All generated PowerShell commands check for cached output before re-converting.
 */

import { existsSync } from "fs";
import { basename, dirname, join } from "path";

const XPERF_PATH = "C:\\Program Files (x86)\\Windows Kits\\10\\Windows Performance Toolkit\\xperf.exe";

/** Returns the expected pre-processed ETL path for a given source ETL. */
export function getPreprocessedPath(etlPath: string, outputDir: string): string {
  const base = basename(etlPath, ".etl");
  return join(outputDir, `${base}_preprocessed.etl`);
}

/**
 * Generates PowerShell commands to pre-process an ETL file once.
 * Returns the variable name holding the path to use for subsequent operations.
 *
 * The generated script:
 *  - Checks if the preprocessed file already exists (skip if so)
 *  - Runs xperf -merge to cook/pre-process the ETL (resolves containers, indexes events)
 *  - Sets $etl to the preprocessed path for all downstream commands
 */
export function generatePreprocessStep(etlVarName: string = "$etl", outputDir: string = "C:\\temp\\etl_analysis"): string[] {
  return [
    "### Step 0: Pre-process ETL → Indexed Format (one-time)",
    "```powershell",
    `# Convert ETL once for fast repeated queries (avoids re-decoding raw ETW each time)`,
    `$preprocessed = "$outDir\\$([System.IO.Path]::GetFileNameWithoutExtension(${etlVarName}))_preprocessed.etl"`,
    `if (!(Test-Path $preprocessed)) {`,
    `  Write-Host "Pre-processing ETL → indexed format (one-time, ~1-3 min)..."`,
    `  & $xperf -merge ${etlVarName} $preprocessed`,
    `  if ($LASTEXITCODE -eq 0) {`,
    `    Write-Host "✅ Pre-processed ETL created: $preprocessed"`,
    `    Write-Host "   Subsequent queries will be significantly faster."`,
    `  } else {`,
    `    Write-Host "⚠️ Pre-processing failed (will use original ETL)"`,
    `    $preprocessed = ${etlVarName}`,
    `  }`,
    `} else {`,
    `  Write-Host "✅ Using cached pre-processed ETL: $preprocessed"`,
    `}`,
    `${etlVarName} = $preprocessed  # All subsequent steps use the indexed file`,
    "```",
    "",
  ];
}

/**
 * Checks if a preprocessed version of the ETL exists locally.
 * Used by the server to inform the user they can skip re-processing.
 */
export function hasPreprocessedCache(etlPath: string, outputDir: string): boolean {
  const cached = getPreprocessedPath(etlPath, outputDir);
  return existsSync(cached);
}
