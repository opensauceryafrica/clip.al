'use client';

/**
 * QR code panel for the link detail page. Renders a live preview by pointing an
 * <img> at the `/api/qr` route (so the API does the rendering + caching), and
 * lets the user flip PNG/SVG, pick one of the brand accent presets, and
 * download. Monochrome, dark-first, built from @clipal/ui primitives.
 */
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clipal/ui';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';

type QrFormat = 'png' | 'svg';
type QrPreset = 'mono' | 'zinc' | 'blue' | 'green' | 'amber';

/** UI swatches — visual chip colour + the preset name sent to the API. Kept in
 * sync with QR_FG_PRESETS in lib/qr.ts (the API is the source of truth/validator). */
const PRESETS: ReadonlyArray<{ name: QrPreset; label: string; swatch: string }> = [
  { name: 'mono', label: 'Mono', swatch: '#0a0a0a' },
  { name: 'zinc', label: 'Zinc', swatch: '#52525b' },
  { name: 'blue', label: 'Slate', swatch: '#3f5b8b' },
  { name: 'green', label: 'Forest', swatch: '#3f6b52' },
  { name: 'amber', label: 'Amber', swatch: '#8b6b3f' },
];

const PREVIEW_SIZE = 512;

export function QrCard({ shortUrl }: { shortUrl: string }) {
  const [format, setFormat] = useState<QrFormat>('png');
  const [fg, setFg] = useState<QrPreset>('mono');

  const previewSrc = useMemo(() => {
    const p = new URLSearchParams({
      data: shortUrl,
      format,
      fg,
      size: String(PREVIEW_SIZE),
    });
    return `/api/qr?${p.toString()}`;
  }, [shortUrl, format, fg]);

  function downloadHref(fmt: QrFormat): string {
    const p = new URLSearchParams({
      data: shortUrl,
      format: fmt,
      fg,
      size: String(fmt === 'png' ? 1024 : PREVIEW_SIZE),
    });
    return `/api/qr?${p.toString()}`;
  }

  const fileBase = useMemo(() => {
    const slug = shortUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'qr-code';
  }, [shortUrl]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>QR code</CardTitle>
        <CardDescription>Scan or print this code to share the short link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* Preview — white plate keeps the code high-contrast in dark mode too. */}
        <div className="flex shrink-0 items-center justify-center rounded-md border border-border bg-white p-3">
          <img
            key={previewSrc}
            src={previewSrc}
            alt={`QR code for ${shortUrl}`}
            width={160}
            height={160}
            className="h-40 w-40"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Format toggle */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Format</span>
            <div className="inline-flex w-fit rounded-md border border-border p-0.5">
              {(['png', 'svg'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  aria-pressed={format === f}
                  className={[
                    'rounded px-3 py-1 text-xs font-medium uppercase transition-colors',
                    format === f
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Accent picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Colour</span>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const active = fg === p.name;
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setFg(p.name)}
                    aria-pressed={active}
                    title={p.label}
                    aria-label={p.label}
                    className={[
                      'size-7 rounded-full border transition-transform active:scale-[0.92]',
                      active
                        ? 'border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background'
                        : 'border-border hover:border-foreground/50',
                    ].join(' ')}
                    style={{ backgroundColor: p.swatch }}
                  />
                );
              })}
            </div>
          </div>

          {/* Downloads */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="secondary" size="sm">
              <a href={downloadHref('png')} download={`${fileBase}.png`}>
                <Download /> PNG
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={downloadHref('svg')} download={`${fileBase}.svg`}>
                <Download /> SVG
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
