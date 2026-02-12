# Deploying RenderShield with Cloudflare

This document explains how to deploy RenderShield in front of an existing
single-page application (SPA) using Cloudflare.

The behavior is intentionally simple:

- Humans receive the normal SPA
- Crawlers receive prerendered static HTML

RenderShield does not execute JavaScript for bots and does not alter crawler
behavior. It only guarantees that complete HTML exists and is served when
appropriate.

---

## Requirements

You will need:

- A Cloudflare account
- A domain using Cloudflare nameservers
- An existing SPA hosted somewhere (Lovable, Vercel, Netlify, etc.)
- RenderShield build output (dist-prerender/)

RenderShield does not host your application. It only controls routing for
crawler requests.

---

## Architecture overview

At a high level:

- Cloudflare proxies all traffic for your domain
- A Worker inspects incoming requests
- Known crawlers are routed to prerendered HTML files
- All other traffic passes through to your SPA unchanged

If prerendered output is missing or incomplete, RenderShield fails the build.

---

## DNS configuration

In Cloudflare → DNS, create a single record:

- Type: CNAME
- Name: @ (or www if applicable)
- Target: your SPA origin (for example: example.lovable.app)
- Proxy status: ON

The proxy must be enabled.  
If it is disabled, the Worker will never execute.

### DNS sanity check

Cloudflare may import old records when you add a domain.

If you see A records pointing to IPs you do not recognize, remove them.
A minimal setup is preferred: one proxied CNAME.

---

## SSL configuration

In Cloudflare → SSL/TLS:

- Set SSL mode to Full or Full (strict)

Avoid Flexible.  
Flexible SSL commonly causes redirect loops between Cloudflare and your origin.

---

## Worker deployment

1) Go to Workers & Pages in the Cloudflare dashboard  
2) Create a new Worker  
3) Paste the contents of: dist-prerender/worker.js  
4) Save and deploy  

The Worker does not require access to your application source code.

---

## Worker routing (required)

Attach the Worker to your domain by adding a route:

- yourdomain.com/*

If you use www, also add:

- www.yourdomain.com/*

Without a route, the Worker will never run.

---

## Hosting prerendered output

The Worker must be able to fetch prerendered files.

You need a static origin that serves paths like:

- /content/example/index.html
- /sitemap.xml
- /robots.txt

Common options include:

- Cloudflare Pages
- Any static file host
- Your existing host (if it supports static files)

Requirement:
A request for a prerendered path must return the HTML file directly.

---

## Sitemap and robots

Ensure these files are publicly accessible:

- https://yourdomain.com/sitemap.xml
- https://yourdomain.com/robots.txt

Submit the sitemap URL in Google Search Console.

---

## Verification

RenderShield includes a verify command to guide testing.

### Worker execution test

Run:

curl -I -H "User-Agent: GPTBot" https://yourdomain.com/content/example

If debug headers are enabled, you should see headers similar to:

- X-Bot-Detected: true
- X-Prerender: true
- X-Final-Path: /content/example/index.html

If these headers are missing:
- The Worker route may not be attached
- The Cloudflare proxy may be disabled
- DNS may still point to a different origin

---

## Content comparison

Human request (SPA response):

curl -s https://yourdomain.com/content/example | grep -i "<title>"

Crawler request (prerendered HTML):

curl -s -H "User-Agent: Googlebot" https://yourdomain.com/content/example | grep -i "<title>"

The crawler response should contain the prerendered, route-specific title.

---

## Common issues

### Worker does not appear to run

Symptoms:
- Site loads normally in a browser
- Crawlers still receive the SPA shell

Check:
- Worker route exists
- DNS proxy is enabled

### 421 errors from origin

This typically indicates a Host header mismatch.

Ensure the Worker constructs a fresh request to the origin rather than
forwarding incoming request headers directly.

### Redirect loops

Symptoms:
- Browser reports “too many redirects”

Fix:
- Set SSL mode to Full or Full (strict)

---

## Final note

RenderShield does not manipulate rankings, indexing, or crawler behavior.

It guarantees one thing only:
that crawlers receive complete, static HTML instead of an empty shell.
