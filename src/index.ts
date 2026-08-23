/**
 * RenderShield programmatic API.
 *
 * CLI usage: `npx rendershield <command>`
 * Library usage: import commands and core helpers from `@lownoise-studio/rendershield`.
 */

export { cmdInit } from "./commands/init.js";
export { cmdBuild } from "./commands/build.js";
export {
  cmdVerify,
  type VerifyProdOptions,
  type VerifyLocalResult,
  type VerifyProdResult,
  type VerifyResult,
} from "./commands/verify.js";

export { loadConfig } from "./core/loadConfig.js";
export { loadAllMarkdownDocs } from "./core/loadMarkdown.js";
export { renderPageHtml } from "./core/renderHtml.js";
export {
  validatePrerenderHtml,
  checkPrerenderContract,
  type ValidateParams,
  type ContractCheckResult,
} from "./core/validateOutput.js";
export { generateSitemapXml } from "./core/generateSitemap.js";
export { generateRobotsTxt } from "./core/generateRobots.js";
export { generateWorkerJs } from "./core/generateWorker.js";

export type { RenderShieldConfig, MarkdownDoc, SchemaType } from "./types.js";
export { SCHEMA_TYPES } from "./types.js";

export {
  RenderShieldError,
  isRenderShieldError,
  renderShieldError,
  formatCliError,
  type RenderShieldErrorCode,
} from "./errors.js";
