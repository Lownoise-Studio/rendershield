import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDoctorHuman } from "../dist/doctor/formatters.js";
import type { DoctorCliResult } from "../dist/doctor/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.join(__dirname, "..", "README.md");

function extractReadmeDoctorJsonExample(readme: string): string {
  const marker =
    "Example JSON shape (abbreviated; summary counts match only the diagnostics shown below";
  const start = readme.indexOf(marker);
  if (start < 0) {
    throw new Error("README Doctor JSON example marker not found");
  }
  const fenceStart = readme.indexOf("```json", start);
  if (fenceStart < 0) {
    throw new Error("README Doctor JSON fence not found");
  }
  const contentStart = fenceStart + "```json".length;
  const fenceEnd = readme.indexOf("```", contentStart);
  if (fenceEnd < 0) {
    throw new Error("README Doctor JSON closing fence not found");
  }
  return readme.slice(contentStart, fenceEnd).trim();
}

function extractReadmeDoctorHumanExample(readme: string): string {
  const marker =
    "Example human output (abbreviated; a real run emits every diagnostic";
  const start = readme.indexOf(marker);
  if (start < 0) {
    throw new Error("README Doctor human example marker not found");
  }
  const fenceStart = readme.indexOf("```text", start);
  if (fenceStart < 0) {
    throw new Error("README Doctor human fence not found");
  }
  const contentStart = fenceStart + "```text".length;
  const fenceEnd = readme.indexOf("```", contentStart);
  if (fenceEnd < 0) {
    throw new Error("README Doctor human closing fence not found");
  }
  return readme
    .slice(contentStart, fenceEnd)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "")
    .replace(/\r\n/g, "\n");
}

describe("README Doctor examples", () => {
  it("JSON example parses and summary counts match displayed diagnostics", () => {
    const readme = fs.readFileSync(README_PATH, "utf8");
    const raw = extractReadmeDoctorJsonExample(readme);
    const parsed = JSON.parse(raw) as DoctorCliResult;

    expect(parsed.command).toBe("doctor");
    expect(typeof parsed.version).toBe("string");
    expect(typeof parsed.ok).toBe("boolean");
    expect(typeof parsed.strict).toBe("boolean");
    expect(typeof parsed.skipOutput).toBe("boolean");
    expect(typeof parsed.configPath).toBe("string");
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);

    const pass = parsed.diagnostics.filter((d) => d.severity === "pass").length;
    const warning = parsed.diagnostics.filter((d) => d.severity === "warning").length;
    const fail = parsed.diagnostics.filter((d) => d.severity === "fail").length;

    expect(parsed.summary).toEqual({ pass, warning, fail });

    for (const diagnostic of parsed.diagnostics) {
      expect(diagnostic).toMatchObject({
        phaseId: expect.any(String),
        code: expect.stringMatching(/^DOCTOR_/),
        severity: expect.stringMatching(/^(pass|warning|fail)$/),
        category: expect.any(String),
        message: expect.any(String),
      });
    }
  });

  it("human example lines match formatDoctorHuman for the abbreviated result", () => {
    const readme = fs.readFileSync(README_PATH, "utf8");
    const humanExample = extractReadmeDoctorHumanExample(readme);
    const raw = extractReadmeDoctorJsonExample(readme);
    const parsed = JSON.parse(raw) as DoctorCliResult;

    const formatted = formatDoctorHuman(parsed);
    expect(formatted).toBe(humanExample);
  });
});
