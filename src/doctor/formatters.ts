import type { DoctorCliResult, DoctorSeverity } from "./types.js";

export function formatDoctorSeverity(severity: DoctorSeverity): string {
  if (severity === "pass") return "PASS";
  if (severity === "warning") return "WARN";
  return "FAIL";
}

function formatOutputLine(result: DoctorCliResult): string {
  if (result.skipOutput) return "Output: (skipped)";

  const pageCount = result.diagnostics.find((d) => d.code === "DOCTOR_OUTPUT_PAGE_COUNT")
    ?.details?.expectedCount;
  const outDir = result.diagnostics.find((d) => d.code === "DOCTOR_OUTPUT_DIR_EXISTS")
    ?.details?.outDir;
  const missing = result.diagnostics.some((d) => d.code === "DOCTOR_OUTPUT_MISSING");

  if (typeof pageCount === "number" && typeof outDir === "string") {
    return `Output: ${outDir}/ (${pageCount} pages)`;
  }
  if (missing) return "Output: (not built)";
  if (typeof outDir === "string") return `Output: ${outDir}/`;
  return "Output: (see diagnostics)";
}

function issueCount(result: DoctorCliResult): number {
  return result.strict
    ? result.summary.fail + result.summary.warning
    : result.summary.fail;
}

export function formatDoctorHuman(result: DoctorCliResult): string {
  const lines: string[] = [
    `RenderShield doctor v${result.version}`,
    "",
    `Config: ${result.configPath}`,
    formatOutputLine(result),
    "",
  ];

  for (const diagnostic of result.diagnostics) {
    const severity = formatDoctorSeverity(diagnostic.severity);
    const code = diagnostic.code.padEnd(32);
    lines.push(`  ${severity}   ${code}  ${diagnostic.message}`);
  }

  lines.push("");
  lines.push(
    `Summary: ${result.summary.pass} pass, ${result.summary.warning} warn, ${result.summary.fail} fail`
  );

  if (result.ok) {
    lines.push("Doctor: OK");
  } else {
    const count = issueCount(result);
    lines.push(`Doctor: FAIL — fix ${count} issue(s) before release.`);
  }

  return lines.join("\n");
}

export function formatDoctorJson(result: DoctorCliResult): string {
  return JSON.stringify(result, null, 2);
}
