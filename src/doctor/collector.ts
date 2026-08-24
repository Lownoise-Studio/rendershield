import type {
  DoctorCategory,
  DoctorDiagnostic,
  DoctorDiagnosticCode,
  DoctorDiagnosticDetails,
  DoctorPhaseId,
  DoctorSeverity,
  DoctorSummary,
} from "./types.js";

export type DoctorDiagnosticInput = {
  phaseId: DoctorPhaseId;
  code: DoctorDiagnosticCode;
  severity: DoctorSeverity;
  category: DoctorCategory;
  message: string;
  hint?: string;
  details?: DoctorDiagnosticDetails;
};

/** Collects diagnostics in deterministic insertion order. */
export class DoctorCollector {
  private readonly diagnostics: DoctorDiagnostic[] = [];

  add(input: DoctorDiagnosticInput): void {
    this.diagnostics.push({ ...input });
  }

  pass(
    phaseId: DoctorPhaseId,
    code: DoctorDiagnosticCode,
    category: DoctorCategory,
    message: string,
    extras?: Pick<DoctorDiagnosticInput, "hint" | "details">
  ): void {
    this.add({ phaseId, code, severity: "pass", category, message, ...extras });
  }

  warn(
    phaseId: DoctorPhaseId,
    code: DoctorDiagnosticCode,
    category: DoctorCategory,
    message: string,
    extras?: Pick<DoctorDiagnosticInput, "hint" | "details">
  ): void {
    this.add({ phaseId, code, severity: "warning", category, message, ...extras });
  }

  fail(
    phaseId: DoctorPhaseId,
    code: DoctorDiagnosticCode,
    category: DoctorCategory,
    message: string,
    extras?: Pick<DoctorDiagnosticInput, "hint" | "details">
  ): void {
    this.add({ phaseId, code, severity: "fail", category, message, ...extras });
  }

  getDiagnostics(): readonly DoctorDiagnostic[] {
    return this.diagnostics;
  }

  summarize(): DoctorSummary {
    let pass = 0;
    let warning = 0;
    let fail = 0;
    for (const d of this.diagnostics) {
      if (d.severity === "pass") pass += 1;
      else if (d.severity === "warning") warning += 1;
      else fail += 1;
    }
    return { pass, warning, fail };
  }

  /** Default: ok when no FAIL. Strict: ok when no FAIL and no WARNING. */
  computeOk(strict: boolean): boolean {
    const { warning, fail } = this.summarize();
    if (fail > 0) return false;
    if (strict && warning > 0) return false;
    return true;
  }
}

export function summarizeDiagnostics(
  diagnostics: readonly DoctorDiagnostic[]
): DoctorSummary {
  const collector = new DoctorCollector();
  for (const d of diagnostics) {
    collector.add(d);
  }
  return collector.summarize();
}

export function computeDoctorOk(
  diagnostics: readonly DoctorDiagnostic[],
  strict: boolean
): boolean {
  const collector = new DoctorCollector();
  for (const d of diagnostics) {
    collector.add(d);
  }
  return collector.computeOk(strict);
}
