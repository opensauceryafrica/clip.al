'use client';

import {
  Button,
  CodeBlock,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@clipal/ui';
import { RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { removeDomainAction, verifyDomainAction } from './actions';

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

/**
 * Per-domain controls: a DNS-instructions dialog (CNAME + TXT records), a
 * re-check trigger, and a destructive remove (with confirmation). The DNS dialog
 * is the primary affordance for any non-active domain; the re-check button
 * nudges the worker to re-evaluate immediately.
 */
export function DomainRowActions({
  domainId,
  domain,
  cnameTarget,
  verificationToken,
  status,
}: {
  domainId: string;
  domain: string;
  cnameTarget: string;
  verificationToken: string;
  status: 'pending_dns' | 'pending_tls' | 'active' | 'error';
}) {
  const records: DnsRecord[] = [
    { type: 'CNAME', name: domain, value: cnameTarget },
    { type: 'TXT', name: `_clipal-verify.${domain}`, value: verificationToken },
  ];

  return (
    <div className="flex items-center justify-end gap-1">
      <DnsDialog domain={domain} records={records} status={status} />

      {status !== 'active' ? (
        <form action={verifyDomainAction}>
          <input type="hidden" name="domainId" value={domainId} />
          <Button type="submit" variant="ghost" size="sm" title="Re-check DNS now">
            <RefreshCw className="size-4" />
            <span className="sr-only">Re-check</span>
          </Button>
        </form>
      ) : null}

      <RemoveDialog domainId={domainId} domain={domain} />
    </div>
  );
}

function DnsDialog({
  domain,
  records,
  status,
}: {
  domain: string;
  records: DnsRecord[];
  status: 'pending_dns' | 'pending_tls' | 'active' | 'error';
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="DNS setup">
          <Settings2 className="size-4" />
          <span className="sr-only">DNS setup</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>DNS setup for {domain}</DialogTitle>
          <DialogDescription>
            Add these two records at your DNS provider. We re-check periodically;
            verification can take a few minutes after the records propagate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {records.map((r) => (
            <div key={r.type} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {r.type} record
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-mono text-foreground break-all">{r.name}</dd>
                <dt className="text-muted-foreground">Value</dt>
                <dd>
                  <CodeBlock value={r.value} />
                </dd>
              </dl>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Once DNS resolves we&apos;ll move the domain to{' '}
          <span className="font-mono">pending_tls</span>, issue a certificate
          on-demand, then flip it to <span className="font-mono">active</span>.
          {status === 'error'
            ? ' This domain hit an error — fix the records above and re-check.'
            : null}
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="sm">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ domainId, domain }: { domainId: string; domain: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          title="Remove domain"
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Remove</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {domain}?</DialogTitle>
          <DialogDescription>
            This stops serving links on this domain and disables every link you
            scoped to it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <form action={removeDomainAction}>
            <input type="hidden" name="domainId" value={domainId} />
            <Button type="submit" variant="destructive" size="sm">
              Remove domain
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
