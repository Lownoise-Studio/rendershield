/**
 * Doctor types. Public Doctor types are exported from the package root (S5+).
 */

export type DoctorSeverity = "pass" | "warning" | "fail";

export type DoctorCategory =
  | "config"
  | "content"
  | "output"
  | "contract"
  | "artifacts"
  | "worker";

/** Offline diagnostic phases in deterministic execution order. */
export type DoctorPhaseId =
  | "config"
  | "outputPath"
  | "contentInventory"
  | "contentSemantics"
  | "siteOriginWorker"
  | "outputPresence"
  | "freshness"
  | "contract"
  | "sitemapRobots"
  | "worker";

export type DoctorDiagnosticCode =
  | "DOCTOR_CONFIG_FOUND"
  | "DOCTOR_CONFIG_MISSING"
  | "DOCTOR_CONFIG_INVALID"
  | "DOCTOR_CONFIG_DEPRECATED_FIELD"
  | "DOCTOR_OUTPUT_PATH_SAFE"
  | "DOCTOR_OUTPUT_PATH_UNSAFE"
  | "DOCTOR_CONTENT_BASEDIR_EXISTS"
  | "DOCTOR_CONTENT_COLLECTION_EMPTY"
  | "DOCTOR_CONTENT_GLOB_MATCHES"
  | "DOCTOR_CONTENT_FRONTMATTER"
  | "DOCTOR_CONTENT_ZERO_DOCS"
  | "DOCTOR_ROUTE_DUPLICATE_SLUG"
  | "DOCTOR_ROUTE_COLLISION"
  | "DOCTOR_ROUTE_BASE_FORMAT"
  | "DOCTOR_COLLECTION_DUPLICATE_NAME"
  | "DOCTOR_CANONICAL_BASE_SET"
  | "DOCTOR_CANONICAL_BASE_HTTPS"
  | "DOCTOR_SPA_ORIGIN_SET"
  | "DOCTOR_ORIGIN_HOST_MISMATCH"
  | "DOCTOR_OG_IMAGE_ABSOLUTE"
  | "DOCTOR_OUTPUT_DIR_EXISTS"
  | "DOCTOR_OUTPUT_MISSING"
  | "DOCTOR_OUTPUT_PAGE_COUNT"
  | "DOCTOR_OUTPUT_ROUTE_MISSING"
  | "DOCTOR_OUTPUT_ORPHAN"
  | "DOCTOR_FRESHNESS_STALE"
  | "DOCTOR_FRESHNESS_CURRENT"
  | "DOCTOR_FRESHNESS_SOURCE_CHANGED"
  | "DOCTOR_FRESHNESS_OUTPUT_CHANGED"
  | "DOCTOR_FRESHNESS_SOURCE_MISSING"
  | "DOCTOR_FRESHNESS_OUTPUT_MISSING"
  | "DOCTOR_MANIFEST_INVALID"
  | "DOCTOR_MANIFEST_UNSUPPORTED_VERSION"
  | "DOCTOR_CONTRACT_PASS"
  | "DOCTOR_CONTRACT_FAIL"
  | "DOCTOR_CANONICAL_HREF_MISMATCH"
  | "DOCTOR_JSONLD_TYPE_MISMATCH"
  | "DOCTOR_SITEMAP_URL_SET"
  | "DOCTOR_SITEMAP_CONFIG_PATH"
  | "DOCTOR_ROBOTS_SITEMAP_LINE"
  | "DOCTOR_ROBOTS_EXPECTED"
  | "DOCTOR_ARTIFACT_SITEMAP_MISSING"
  | "DOCTOR_ARTIFACT_ROBOTS_MISSING"
  | "DOCTOR_ARTIFACT_WORKER_MISSING"
  | "DOCTOR_WORKER_DISABLED"
  | "DOCTOR_WORKER_REWRITE_COVERAGE"
  | "DOCTOR_WORKER_FILE_PRESENT"
  | "DOCTOR_WORKER_GENERATED";

export type DoctorDiagnosticDetails = Record<string, unknown>;

export type DoctorDiagnostic = {
  phaseId: DoctorPhaseId;
  code: DoctorDiagnosticCode;
  severity: DoctorSeverity;
  category: DoctorCategory;
  message: string;
  hint?: string;
  details?: DoctorDiagnosticDetails;
};

export type DoctorSummary = {
  pass: number;
  warning: number;
  fail: number;
};

export type DoctorEngineOptions = {
  strict?: boolean;
  skipOutput?: boolean;
  configPath?: string;
};

export type DoctorResult = {
  ok: boolean;
  strict: boolean;
  configPath: string;
  skipOutput: boolean;
  summary: DoctorSummary;
  diagnostics: DoctorDiagnostic[];
};

/** CLI/API result shape for `cmdDoctor` and `--json` output. */
export type DoctorCliResult = DoctorResult & {
  version: string;
  command: "doctor";
};
