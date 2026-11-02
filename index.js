#!/usr/bin/env node
// Solispec MCP server: a thin client of the public Solispec REST API (https://solispec.com/v1/openapi.json).
// Auth: an organization API key (cabinet -> API), passed as SOLISPEC_API_KEY. The API is part of the Business plan.
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const BASE = (process.env.SOLISPEC_BASE_URL || 'https://solispec.com').replace(/\/+$/, '');
const KEY = process.env.SOLISPEC_API_KEY || '';
const READ_ONLY = /^(1|true|yes)$/i.test(process.env.SOLISPEC_READ_ONLY || '');
const VERSION = '0.1.0';

const uuid = z.string().uuid();
const versionNo = z.number().int().min(1).describe('version number, 1-based');
const status = z.enum(['draft', 'offer', 'won', 'lost', 'done', 'archived']);
const priceGroup = z.enum(['metal', 'fasteners', 'supports', 'work', 'equipment', 'electrics', 'other']);
const country = z.enum(['UA', 'PL', 'EU']).optional().describe('norms of the report: UA, PL or EU');
const locale = z.enum(['uk', 'en', 'pl']).optional().describe('language of the document');

async function api(method, path, { query, body } = {}) {
  if (!KEY) throw new Error('SOLISPEC_API_KEY is not set. Create a key in the Solispec cabinet (API section, Business plan).');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      accept: 'application/json, text/html;q=0.9',
      'user-agent': `solispec-mcp/${VERSION}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 500);
    try { const j = JSON.parse(text); detail = [j.error, j.reason, j.limit && `limit ${j.limit}`, j.plan && `plan ${j.plan}`].filter(Boolean).join(', '); } catch {}
    const hint = res.status === 401 ? ' (check SOLISPEC_API_KEY)' : res.status === 402 ? ' (the plan does not include this; the API needs Business)' : res.status === 403 ? ' (a read key cannot write, or the role is too low)' : res.status === 429 ? ' (rate limited, retry later)' : '';
    throw new Error(`Solispec API ${method} ${path} -> ${res.status}: ${detail}${hint}`);
  }
  if (type.includes('application/json')) return text ? JSON.parse(text) : null;
  return text;
}

const htmlToText = (html) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const run = (fn) => async (args) => {
  try { return ok(await fn(args || {})); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] }; }
};

const server = new McpServer({ name: 'solispec', version: VERSION });
const read = (name, description, inputSchema, fn) =>
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } }, run(fn));
const write = (name, description, inputSchema, fn, destructive = false) => {
  if (READ_ONLY) return;
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: false, destructiveHint: destructive, openWorldHint: true } }, run(fn));
};

// ---- read ----
read('whoami', 'The Solispec organization and the API key in use (plan, scope, limits).', z.object({}), async () => {
  const me = await api('GET', '/v1/me');
  if (me && typeof me === 'object' && !me.org) throw new Error('The API key was not recognized (no organization). Check SOLISPEC_API_KEY.');
  return me;
});
read('list_projects', 'List projects of the organization. Filters: status, clientId, tag, free-text q; paging with cursor.',
  z.object({ status: status.optional(), clientId: uuid.optional(), tag: z.string().optional(), q: z.string().optional(), cursor: z.string().optional() }),
  (a) => api('GET', '/v1/projects', { query: a }));
read('get_project', 'A project with its draft and the list of saved versions.', z.object({ id: uuid }), ({ id }) => api('GET', `/v1/projects/${id}`));
read('get_version', 'A saved project version: snapshot (frame, panels, site, loads) and the calculation summary.',
  z.object({ id: uuid, n: versionNo }), ({ id, n }) => api('GET', `/v1/projects/${id}/versions/${n}`));
read('get_report', 'The calculation report of a version (loads, structural checks, bill of materials) as plain text. Set html=true for the raw HTML.',
  z.object({ id: uuid, n: versionNo, country, locale, html: z.boolean().optional() }),
  async ({ id, n, country, locale, html }) => { const r = await api('GET', `/v1/projects/${id}/versions/${n}/report`, { query: { country, locale } }); return html || typeof r !== 'string' ? r : htmlToText(r); });
read('list_clients', 'List clients (free-text q, cursor paging).', z.object({ q: z.string().optional(), cursor: z.string().optional() }), (a) => api('GET', '/v1/clients', { query: a }));
read('get_client', 'A client with their projects.', z.object({ id: uuid }), ({ id }) => api('GET', `/v1/clients/${id}`));
read('list_offers', 'List commercial proposals, optionally of one project.', z.object({ projectId: uuid.optional() }), (a) => api('GET', '/v1/offers', { query: a }));
read('get_offer', 'A proposal with its status, views and acceptance.', z.object({ id: uuid }), ({ id }) => api('GET', `/v1/offers/${id}`));
read('list_reviews', 'Engineer reviews (Business): filter by status or project.', z.object({ status: z.string().optional(), projectId: uuid.optional() }), (a) => api('GET', '/v1/reviews', { query: a }));
read('get_document', 'Status of a generated PDF document: queued, ready or failed (with its download path when ready).', z.object({ id: uuid }), ({ id }) => api('GET', `/v1/documents/${id}`));
read('get_prices', "The organization's price list: every item with its typical price and the company's own price, in the price-list currency.",
  z.object({ locale }), (a) => api('GET', '/v1/prices', { query: { ...a, format: 'json' } }));

// ---- write (hidden with SOLISPEC_READ_ONLY=1) ----
write('create_project', 'Create a project (empty draft, or with a snapshot exported from Solispec).',
  z.object({ name: z.string().min(1).max(200), clientId: uuid.nullable().optional(), status: status.optional(), tags: z.array(z.string().max(40)).max(20).optional(), snapshot: z.record(z.string(), z.any()).optional() }),
  (b) => api('POST', '/v1/projects', { body: b }));
write('update_project', 'Rename a project or set its status, client, tags or notes.',
  z.object({ id: uuid, name: z.string().max(200).optional(), status: status.optional(), clientId: uuid.nullable().optional(), tags: z.array(z.string().max(40)).max(20).optional(), notes: z.string().max(2000).nullable().optional() }),
  ({ id, ...b }) => api('PATCH', `/v1/projects/${id}`, { body: b }));
write('save_version', 'Freeze the current draft as a new version; the server recalculates it.',
  z.object({ id: uuid, label: z.string().max(200).optional() }), ({ id, ...b }) => api('POST', `/v1/projects/${id}/versions`, { body: b }));
write('queue_report_pdf', 'Queue the calculation report of a version as PDF; poll get_document for the result.',
  z.object({ id: uuid, n: versionNo, country, locale }), ({ id, n, ...b }) => api('POST', `/v1/projects/${id}/versions/${n}/pdf`, { body: b }));
write('create_offer', 'Create a commercial proposal (draft) from a version. variants=true adds three priced options (grid / hybrid + battery / + generator).',
  z.object({ id: uuid, n: versionNo, clientId: uuid.nullable().optional(), validDays: z.number().int().min(1).max(90).optional(), terms: z.string().optional(), country: z.string().optional(), locale: z.string().optional(), variants: z.boolean().optional() }),
  ({ id, n, ...b }) => api('POST', `/v1/projects/${id}/versions/${n}/offers`, { body: b }));
write('send_offer', 'Mark a proposal as sent: freezes its figures and returns the client link. Only when the user asked to send it.',
  z.object({ id: uuid }), ({ id }) => api('POST', `/v1/offers/${id}/send`), true);
write('revoke_offer', "Withdraw a proposal's client link.", z.object({ id: uuid }), ({ id }) => api('POST', `/v1/offers/${id}/revoke`), true);
write('queue_offer_pdf', 'Queue a proposal as PDF; poll get_document for the result.', z.object({ id: uuid }), ({ id }) => api('POST', `/v1/offers/${id}/pdf`));
write('request_review', 'Send a version to engineer review (Business).', z.object({ id: uuid, n: versionNo }), ({ id, n }) => api('POST', `/v1/projects/${id}/versions/${n}/review`));
write('create_client', 'Create a client.',
  z.object({ name: z.string().min(1), email: z.string().optional(), phone: z.string().optional(), address: z.string().optional(), notes: z.string().optional() }),
  (b) => api('POST', '/v1/clients', { body: b }));
write('update_client', 'Update a client.',
  z.object({ id: uuid, name: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), address: z.string().optional(), notes: z.string().optional() }),
  ({ id, ...b }) => api('PATCH', `/v1/clients/${id}`, { body: b }));
write('update_prices', "Set the company's own prices (price-list currency) for items by id; price null clears it. dryRun defaults to true: shows the changes without saving.",
  z.object({ items: z.array(z.object({ id: z.string(), price: z.union([z.number().min(0), z.string(), z.null()]) })).min(1).max(5000), dryRun: z.boolean().default(true) }),
  ({ items, dryRun }) => api('PATCH', '/v1/prices', { query: { dryRun }, body: items }), true);
write('adjust_prices', 'Change many prices by a percentage (whole list, one group, only own prices, or listed ids). dryRun defaults to true.',
  z.object({ percent: z.number().min(-90).max(1000).refine((x) => x !== 0, 'percent must not be 0'), base: z.enum(['current', 'typical']).optional(), group: priceGroup.optional(), onlyOurs: z.boolean().optional(), ids: z.array(z.string()).max(5000).optional(), dryRun: z.boolean().default(true) }),
  ({ dryRun, ...b }) => api('POST', '/v1/prices/adjust', { query: { dryRun }, body: b }), true);

await server.connect(new StdioServerTransport());
