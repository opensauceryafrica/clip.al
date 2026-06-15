'use client';

import { Button, Input, Label } from '@clipal/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * Shared routing-rules editor for geo / device / A-B modes. Manages an array of
 * rows in local state and serializes them to JSON into a hidden field named
 * `rules`, matching the shape `parseRules`/`parseRoutingRules` expect on the
 * server: `[{ match: DestinationMatch, url }]`. The server re-validates, so this
 * is purely a UX layer.
 *
 * `mode === 'single'` renders nothing (the single destination lives in the main
 * destination field).
 */
export type RulesMode = 'single' | 'geo' | 'device' | 'ab';

const DEVICE_CLASSES = ['mobile', 'tablet', 'desktop', 'bot'] as const;
type DeviceClass = (typeof DEVICE_CLASSES)[number];

interface RuleRow {
  /** Stable key for React; not serialized. */
  key: string;
  url: string;
  /** geo: comma-separated ISO country codes. */
  countries: string;
  /** device class. */
  device: DeviceClass;
  /** ab weight. */
  weight: string;
}

/** A serialized rule row exactly as the actions parse it. */
type SerializedRule =
  | { match: { type: 'geo'; countries: string[] }; url: string }
  | { match: { type: 'device'; device: DeviceClass }; url: string }
  | { match: { type: 'ab'; weight: number }; url: string };

let _seq = 0;
function newRow(): RuleRow {
  _seq += 1;
  return { key: `r${_seq}`, url: '', countries: '', device: 'mobile', weight: '50' };
}

function rowsFromInitial(initial: InitialRule[] | undefined): RuleRow[] {
  if (!initial || initial.length === 0) return [newRow()];
  return initial.map((r) => {
    const row = newRow();
    row.url = r.url;
    if (r.match.type === 'geo') row.countries = r.match.countries.join(', ');
    else if (r.match.type === 'device') row.device = r.match.device;
    else row.weight = String(r.match.weight);
    return row;
  });
}

export interface InitialRule {
  url: string;
  match:
    | { type: 'geo'; countries: string[] }
    | { type: 'device'; device: DeviceClass }
    | { type: 'ab'; weight: number };
}

export function LinkBuilderRulesEditor({
  mode,
  initial,
}: {
  mode: RulesMode;
  initial?: InitialRule[];
}) {
  const [rows, setRows] = useState<RuleRow[]>(() => rowsFromInitial(initial));

  const serialized = useMemo<string>(() => {
    if (mode === 'single') return '';
    const out: SerializedRule[] = rows.map((r) => {
      if (mode === 'geo') {
        const countries = r.countries
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        return { match: { type: 'geo', countries }, url: r.url.trim() };
      }
      if (mode === 'device') {
        return { match: { type: 'device', device: r.device }, url: r.url.trim() };
      }
      return { match: { type: 'ab', weight: Number(r.weight) || 0 }, url: r.url.trim() };
    });
    return JSON.stringify(out);
  }, [rows, mode]);

  if (mode === 'single') return null;

  function update(key: string, patch: Partial<RuleRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const weightTotal =
    mode === 'ab' ? rows.reduce((a, r) => a + (Number(r.weight) || 0), 0) : 0;

  return (
    <div className="space-y-3">
      {/* The server reads this single field. */}
      <input type="hidden" name="rules" value={serialized} />

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className="grid gap-2 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-[1fr_auto]"
          >
            <div className="space-y-2">
              {mode === 'geo' ? (
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`countries-${row.key}`}>
                    Countries (ISO codes, comma-separated)
                  </Label>
                  <Input
                    id={`countries-${row.key}`}
                    value={row.countries}
                    onChange={(e) => update(row.key, { countries: e.target.value })}
                    placeholder="US, GB, NG"
                    className="font-mono text-xs uppercase"
                  />
                </div>
              ) : null}

              {mode === 'device' ? (
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`device-${row.key}`}>
                    Device class
                  </Label>
                  <select
                    id={`device-${row.key}`}
                    value={row.device}
                    onChange={(e) => update(row.key, { device: e.target.value as DeviceClass })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm capitalize text-foreground transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                  >
                    {DEVICE_CLASSES.map((d) => (
                      <option key={d} value={d} className="capitalize">
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {mode === 'ab' ? (
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`weight-${row.key}`}>
                    Variant {String.fromCharCode(65 + i)} · weight
                  </Label>
                  <Input
                    id={`weight-${row.key}`}
                    type="number"
                    min={0}
                    value={row.weight}
                    onChange={(e) => update(row.key, { weight: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>
              ) : null}

              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`url-${row.key}`}>
                  Destination URL
                </Label>
                <Input
                  id={`url-${row.key}`}
                  type="url"
                  value={row.url}
                  onChange={(e) => update(row.key, { url: e.target.value })}
                  placeholder="https://example.com/variant"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex items-start justify-end sm:items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Remove rule"
                className="px-2"
                disabled={rows.length <= 1}
                onClick={() => remove(row.key)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((prev) => [...prev, newRow()])}
        >
          <Plus className="size-4" /> Add rule
        </Button>
        {mode === 'ab' ? (
          <span className="text-xs text-muted-foreground">
            Total weight: <span className="font-mono">{weightTotal}</span>
          </span>
        ) : null}
        {mode === 'geo' ? (
          <span className="text-xs text-muted-foreground">First match wins</span>
        ) : null}
      </div>
    </div>
  );
}
