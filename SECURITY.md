# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.2.x   | Yes       |
| < 1.2   | No        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email security reports to the maintainers via the contact listed on the [GitHub repository](https://github.com/Lownoise-Studio/rendershield). Include:

- A description of the issue and potential impact
- Steps to reproduce
- Affected versions
- Any suggested fix, if you have one

We aim to acknowledge reports within **5 business days** and will coordinate disclosure and a fix before publishing details.

## Scope notes

RenderShield generates static HTML and an optional Cloudflare Worker template. Deployment, DNS, TLS, and Worker binding configuration are the operator's responsibility. Security issues in generated Worker routing logic or path-safety checks in the build command are in scope for this project.

## Content and configuration boundaries

- Markdown frontmatter is **data-only YAML** delimited by `---`. RenderShield does **not** execute JavaScript frontmatter (including language-tagged forms such as `---js` / `---javascript`).
- Collection `pattern` values are developer-configured globs. RenderShield bounds pattern length, rejects control characters and extglob syntax, and disables fast-glob extglob/brace expansion for collection discovery.
