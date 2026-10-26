import { parse } from "parse5";
import { renderShieldError } from "../errors.js";

export type SearchControlExpectations = {
  expectRobots?: string;
  expectXRobotsTag?: string;
  expectNoSnippet?: boolean;
};

type HtmlNode = {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
};

// Compare comma-delimited directives without depending on order or casing.
function normalize(value: string): string {
  return value.split(",").map(v => v.trim().replace(/\s+/g, " ").toLowerCase()).filter(Boolean).sort().join(",");
}

export function assertSearchControls(html: string, headers: Headers, expected: SearchControlExpectations): void {
  const robots: string[] = [];
  let noSnippet = false;
  function visit(node: HtmlNode): void {
    const attr = (name: string) => node.attrs?.find(a => a.name === name)?.value;
    if (node.nodeName === "meta" && attr("name")?.toLowerCase() === "robots") robots.push(attr("content") ?? "");
    if (["div", "span", "section"].includes(node.nodeName) && attr("data-nosnippet") !== undefined) noSnippet = true;
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html) as HtmlNode);
  const fail = (message: string): never => { throw renderShieldError("VERIFY_FAILED", `Search controls: ${message}`); };
  if (expected.expectRobots !== undefined && normalize(robots.join(",")) !== normalize(expected.expectRobots)) fail("robots meta does not match expected directives");
  if (expected.expectXRobotsTag !== undefined && normalize(headers.get("x-robots-tag") ?? "") !== normalize(expected.expectXRobotsTag)) fail("X-Robots-Tag does not match expected directives");
  if (expected.expectNoSnippet && !noSnippet) fail("missing data-nosnippet element");
}
