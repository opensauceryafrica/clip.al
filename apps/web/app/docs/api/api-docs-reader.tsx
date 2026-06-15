'use client';

import { Check, ChevronRight, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@clipal/ui';

/**
 * A CSP-safe OpenAPI reader. Fetches `/api/v1/openapi.json` client-side and
 * renders a monochrome operation list with per-operation cURL / TypeScript /
 * Python snippets and copy buttons. No external CDN, no inline scripts — this
 * compiles to a `self`-served bundle, so it passes the app's strict CSP.
 */

interface OpenApiSpec {
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, RawOp>>;
  components?: { schemas?: Record<string, unknown> };
}

interface RawOp {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: unknown }>;
  requestBody?: {
    content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown> } } };
  };
  responses?: Record<string, { description?: string }>;
}

interface Operation extends RawOp {
  method: string;
  path: string;
}

const METHOD_ORDER = ['get', 'post', 'patch', 'put', 'delete'];

const METHOD_TONE: Record<string, string> = {
  get: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  post: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
  patch: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  put: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  delete: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      aria-label={copied ? 'Copied' : 'Copy'}
      className="absolute right-2 top-2 rounded border border-border bg-background/80 p-1.5 text-muted-foreground transition-colors hover:text-foreground active:translate-y-px"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-border bg-card p-4 pr-12 font-mono text-xs leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} />
    </div>
  );
}

function bodyExample(op: Operation): string | null {
  const props = op.requestBody?.content?.['application/json']?.schema?.properties;
  if (!props) return null;
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    obj[key] = key === 'destination' || key === 'data' ? 'https://example.com/page' : '…';
  }
  return JSON.stringify(obj, null, 2);
}

function curlSnippet(op: Operation, server: string): string {
  const url = `${server}${op.path.replace('{code}', 'abc1234')}`;
  const lines = [`curl -X ${op.method.toUpperCase()} "${url}"`, `  -H "Authorization: Bearer $CLIPAL_API_KEY"`];
  const body = bodyExample(op);
  if (body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${body.replace(/\n\s*/g, ' ')}'`);
  }
  return lines.join(' \\\n');
}

function tsSnippet(op: Operation, server: string): string {
  const url = `${server}${op.path.replace('{code}', 'abc1234')}`;
  const body = bodyExample(op);
  const init: string[] = [`  method: '${op.method.toUpperCase()}',`, `  headers: {`, `    Authorization: \`Bearer \${process.env.CLIPAL_API_KEY}\`,`];
  if (body) init.push(`    'Content-Type': 'application/json',`);
  init.push(`  },`);
  if (body) init.push(`  body: JSON.stringify(${body.replace(/\n/g, '\n  ')}),`);
  return `const res = await fetch('${url}', {\n${init.join('\n')}\n});\nconst data = await res.json();`;
}

function pySnippet(op: Operation, server: string): string {
  const url = `${server}${op.path.replace('{code}', 'abc1234')}`;
  const body = bodyExample(op);
  const args = [`    "${url}"`, `    headers={"Authorization": f"Bearer {CLIPAL_API_KEY}"}`];
  if (body) args.push(`    json=${body.replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False')}`);
  return `import requests\n\nres = requests.${op.method}(\n${args.join(',\n')},\n)\ndata = res.json()`;
}

function OperationCard({ op, server }: { op: Operation; server: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <span
          className={cn(
            'inline-flex w-16 shrink-0 justify-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase',
            METHOD_TONE[op.method] ?? 'text-muted-foreground border-border',
          )}
        >
          {op.method}
        </span>
        <code className="font-mono text-sm text-foreground">{op.path}</code>
        <span className="ml-2 truncate text-sm text-muted-foreground">{op.summary}</span>
        <ChevronRight
          className={cn(
            'ml-auto size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          {op.description && <p className="text-sm text-muted-foreground">{op.description}</p>}
          {op.parameters && op.parameters.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Parameters
              </h4>
              <ul className="space-y-1">
                {op.parameters.map((p) => (
                  <li key={`${p.in}:${p.name}`} className="flex items-center gap-2 text-sm">
                    <code className="font-mono text-foreground">{p.name}</code>
                    <span className="text-xs text-muted-foreground">in {p.in}</span>
                    {p.required && (
                      <Badge variant="pending" className="text-[10px]">
                        required
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Tabs defaultValue="curl">
            <TabsList>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="ts">TypeScript</TabsTrigger>
              <TabsTrigger value="py">Python</TabsTrigger>
            </TabsList>
            <TabsContent value="curl">
              <Snippet code={curlSnippet(op, server)} />
            </TabsContent>
            <TabsContent value="ts">
              <Snippet code={tsSnippet(op, server)} />
            </TabsContent>
            <TabsContent value="py">
              <Snippet code={pySnippet(op, server)} />
            </TabsContent>
          </Tabs>
          {op.responses && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Responses
              </h4>
              <ul className="space-y-1">
                {Object.entries(op.responses).map(([status, r]) => (
                  <li key={status} className="flex items-center gap-2 text-sm">
                    <code className="font-mono text-foreground">{status}</code>
                    <span className="text-muted-foreground">{r.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiDocsReader() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/openapi.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((json) => {
        if (!cancelled) setSpec(json as OpenApiSpec);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const operations = useMemo(() => {
    if (!spec) return [];
    const ops: Operation[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, raw] of Object.entries(methods)) {
        ops.push({ ...raw, method, path });
      }
    }
    return ops.sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
    });
  }, [spec]);

  const grouped = useMemo(() => {
    const map = new Map<string, Operation[]>();
    for (const op of operations) {
      const tag = op.tags?.[0] ?? 'Other';
      const list = map.get(tag) ?? [];
      list.push(op);
      map.set(tag, list);
    }
    return [...map.entries()];
  }, [operations]);

  if (error) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Could not load the API specification. Try reloading the page.
      </p>
    );
  }

  if (!spec) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-card/40" />
        ))}
      </div>
    );
  }

  const server = spec.servers[0]?.url ?? '/api/v1';

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Every request is authenticated with a bearer API key minted in{' '}
          <span className="font-medium text-foreground">Settings → API keys</span>. Pass it in the{' '}
          <code className="font-mono text-foreground">Authorization</code> header.
        </p>
        <Snippet code={`Authorization: Bearer clpl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`} />
        <p className="text-sm text-muted-foreground">
          Errors share one envelope so clients can branch on{' '}
          <code className="font-mono text-foreground">error.code</code>:
        </p>
        <Snippet
          code={JSON.stringify(
            { error: { code: 'invalid_request', message: 'The request body or parameters are invalid.' } },
            null,
            2,
          )}
        />
      </section>

      {grouped.map(([tag, ops]) => (
        <section key={tag} className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">{tag}</h2>
          <div className="space-y-2">
            {ops.map((op) => (
              <OperationCard key={`${op.method}:${op.path}`} op={op} server={server} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
