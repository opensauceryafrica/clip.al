'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Spinner } from '@clipal/ui';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { startBulkImportAction, type BulkImportState } from './actions';

const initialState: BulkImportState = {};

const SAMPLE_CSV = `destination_url,slug,password,expires_at,tags,note
https://example.com/launch,launch24,,2026-12-31,marketing,Q4 launch
https://example.com/docs,,,,,Docs link
https://example.com/secret,vault,hunter2,,internal,Protected`;

interface Progress {
  total: number;
  done: number;
  ok: number;
  failed: number;
  status: string;
}

export default function BulkImportPage() {
  const [state, formAction, pending] = useActionState(startBulkImportAction, initialState);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [finished, setFinished] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Open the SSE progress stream once the action returns an importId.
  useEffect(() => {
    if (!state.ok || !state.importId) return;

    setProgress(null);
    setFinished(false);

    const es = new EventSource(
      `/links/bulk/progress?importId=${encodeURIComponent(state.importId)}`,
    );
    esRef.current = es;

    const onProgress = (e: MessageEvent): void => {
      try {
        setProgress(JSON.parse(e.data) as Progress);
      } catch {
        /* ignore malformed frame */
      }
    };
    const onDone = (e: MessageEvent): void => {
      try {
        setProgress(JSON.parse(e.data) as Progress);
      } catch {
        /* ignore */
      }
      setFinished(true);
      es.close();
    };

    es.addEventListener('progress', onProgress);
    es.addEventListener('done', onDone);
    es.onerror = (): void => {
      // The stream ends with a normal close after `done`; only surface an early
      // disconnect (before we saw `done`).
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [state.ok, state.importId]);

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  const errorCsvHref = state.errorCsv
    ? `data:text/csv;charset=utf-8,${encodeURIComponent(state.errorCsv)}`
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Bulk import"
        description="Upload a CSV to create many links at once. Each row is safety-checked."
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            Columns: <code className="font-mono text-foreground">destination_url</code> (required),
            then optional <code className="font-mono text-foreground">slug</code>,{' '}
            <code className="font-mono text-foreground">password</code>,{' '}
            <code className="font-mono text-foreground">expires_at</code>,{' '}
            <code className="font-mono text-foreground">tags</code>,{' '}
            <code className="font-mono text-foreground">note</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file">CSV file</Label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="block w-full cursor-pointer rounded-md border border-input bg-transparent text-sm text-foreground file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-input file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
              />
            </div>

            <details className="rounded-md border border-border bg-card/50">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Sample format
              </summary>
              <pre className="overflow-x-auto border-t border-border px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                {SAMPLE_CSV}
              </pre>
            </details>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner className="mr-2 size-4" /> Importing…
                  </>
                ) : (
                  'Import'
                )}
              </Button>
              {state.reason === 'plan_required' ? (
                <Button asChild variant="secondary">
                  <Link href="/settings/billing">Upgrade to import</Link>
                </Button>
              ) : null}
            </div>
          </form>

          {/* ── Validation / gate errors ─────────────────────────────────── */}
          {state.error && !state.ok ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p>{state.error}</p>
              {errorCsvHref ? (
                <a
                  href={errorCsvHref}
                  download="bulk-import-errors.csv"
                  className="inline-block font-medium underline underline-offset-4 hover:no-underline"
                >
                  Download error report
                </a>
              ) : null}
            </div>
          ) : null}

          {/* ── Live progress ────────────────────────────────────────────── */}
          {state.ok && state.importId ? (
            <div className="space-y-3 rounded-md border border-border bg-card/50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {finished ? 'Import complete' : 'Importing…'}
                </span>
                <span className="font-mono text-muted-foreground">
                  {progress ? `${progress.done}/${progress.total}` : '—'}
                </span>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Created" value={progress?.ok ?? 0} />
                <Stat label="Failed" value={progress?.failed ?? 0} />
                <Stat label="Total" value={progress?.total ?? 0} />
              </dl>

              {finished ? (
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/links">View links</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
