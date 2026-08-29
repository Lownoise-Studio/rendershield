import yaml from "js-yaml";
import { renderShieldError } from "../errors.js";

export type YamlFrontmatterResult = {
  data: Record<string, unknown>;
  content: string;
};

const OPEN = "---";
const CLOSE = "---";

/**
 * Parse data-only YAML frontmatter delimited by `---`.
 *
 * Supports plain YAML openers (`---` / `---yaml` / `---yml`) only.
 * Does not evaluate JavaScript, and rejects other language-tagged openers
 * (for example `---js` / `---javascript` / `---json`).
 */
export function parseYamlFrontmatter(
  raw: string,
  sourceLabel = "markdown"
): YamlFrontmatterResult {
  if (!raw.startsWith(OPEN)) {
    return { data: {}, content: raw };
  }

  const afterOpen = raw.slice(OPEN.length);
  const firstLineMatch = afterOpen.match(/^([^\r\n]*)(\r?\n|$)/);
  if (!firstLineMatch) {
    return { data: {}, content: "" };
  }

  const language = firstLineMatch[1].trim().toLowerCase();
  if (language !== "" && language !== "yaml" && language !== "yml") {
    throw renderShieldError(
      "CONTENT_INVALID",
      `Unsupported frontmatter language "${firstLineMatch[1].trim()}" in ${sourceLabel}. RenderShield accepts data-only YAML frontmatter (---) only.`
    );
  }

  const bodyStart = firstLineMatch[0].length;
  const rest = afterOpen.slice(bodyStart);
  const closeMatch = rest.match(/\r?\n---(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    throw renderShieldError(
      "CONTENT_INVALID",
      `Unterminated YAML frontmatter in ${sourceLabel}. Expected a closing --- delimiter.`
    );
  }

  const matterBlock = rest.slice(0, closeMatch.index);
  const content = rest.slice(closeMatch.index + closeMatch[0].length);

  if (matterBlock.trim() === "") {
    return { data: {}, content };
  }

  let loaded: unknown;
  try {
    // js-yaml DEFAULT_SCHEMA is data-only (no JS types / function evaluation).
    loaded = yaml.load(matterBlock, { schema: yaml.DEFAULT_SCHEMA });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw renderShieldError(
      "CONTENT_INVALID",
      `Invalid YAML frontmatter in ${sourceLabel}: ${detail}`
    );
  }

  if (loaded == null) {
    return { data: {}, content };
  }
  if (typeof loaded !== "object" || Array.isArray(loaded)) {
    throw renderShieldError(
      "CONTENT_INVALID",
      `YAML frontmatter in ${sourceLabel} must be a mapping of fields.`
    );
  }

  return { data: loaded as Record<string, unknown>, content };
}
