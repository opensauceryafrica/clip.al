'use client';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Textarea,
} from '@clipal/ui';
import { Flag } from 'lucide-react';
import { useActionState } from 'react';
import { reportLinkAction } from '@/app/p/[code]/actions';
import type { ReportState } from '@/lib/action-state';

const initialState: ReportState = { ok: false };

const REASONS: ReadonlyArray<[value: string, label: string]> = [
  ['phishing', 'Phishing'],
  ['malware', 'Malware'],
  ['spam', 'Spam'],
  ['nsfw', 'Adult / NSFW'],
  ['illegal', 'Illegal content'],
  ['other', 'Something else'],
];

export function ReportDialog({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState(reportLinkAction, initialState);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Flag /> Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this link</DialogTitle>
          <DialogDescription>
            Tell us what’s wrong with the destination. Reports help keep clip.al clean.
          </DialogDescription>
        </DialogHeader>

        {state.ok ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Thanks — we’ll review this link.</p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Close</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="code" value={code} />
            <div className="space-y-2">
              <label htmlFor="reason" className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Reason
              </label>
              <select
                id="reason"
                name="reason"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus-visible:border-zinc-400 focus-visible:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              >
                <option value="" disabled>
                  Select a reason
                </option>
                {REASONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="note" className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Note <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <Textarea id="note" name="note" maxLength={1000} placeholder="Anything else we should know?" />
            </div>
            {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? 'Submitting…' : 'Submit report'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
