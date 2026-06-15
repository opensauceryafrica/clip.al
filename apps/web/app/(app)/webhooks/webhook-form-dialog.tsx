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
  Input,
  Label,
} from '@clipal/ui';
import { Plus } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import type { FormActionState } from '@/lib/action-state';
import {
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
} from '@/lib/webhooks';
import {
  createWebhookAction,
  updateWebhookAction,
  type WebhookCreateState,
} from './actions';

const createInitial: WebhookCreateState = {};
const editInitial: FormActionState = {};

/** Shared event checkbox grid. */
function EventCheckboxes({ selected }: { selected?: readonly WebhookEventType[] }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-foreground">Events</legend>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {WEBHOOK_EVENT_TYPES.map((type) => (
          <label
            key={type}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent has-[:checked]:border-foreground/30"
          >
            <input
              type="checkbox"
              name="events"
              value={type}
              defaultChecked={selected?.includes(type)}
              className="size-4 cursor-pointer accent-foreground"
            />
            <span className="truncate">{WEBHOOK_EVENT_LABELS[type]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Create dialog. On success the action returns the plaintext signing secret,
 * which we surface ONCE (copyable) and never again — the dialog flips into a
 * "save your secret" confirmation step rather than closing immediately.
 */
export function CreateWebhookDialog({
  triggerLabel = 'New webhook',
}: {
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createWebhookAction, createInitial);

  // When closed, reset to a clean form on next open (re-mount clears the secret).
  function onOpenChange(next: boolean) {
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.secret ? (
          <SecretReveal secret={state.secret} onDone={() => setOpen(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New webhook</DialogTitle>
              <DialogDescription>
                We&apos;ll POST signed event payloads to this URL.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">Delivery URL</Label>
                <Input
                  id="webhook-url"
                  name="url"
                  type="url"
                  required
                  autoComplete="off"
                  placeholder="https://example.com/webhooks/clipal"
                />
              </div>
              <EventCheckboxes />
              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="secondary" size="sm">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? 'Creating…' : 'Create webhook'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One-time secret reveal shown after a successful create. */
function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Signing secret</DialogTitle>
        <DialogDescription>
          Copy this secret now. For your security it won&apos;t be shown again — use it to
          verify the <code className="font-mono">X-clipal-Signature</code> header.
        </DialogDescription>
      </DialogHeader>
      <CodeBlock value={secret} />
      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone}>
          I&apos;ve saved it
        </Button>
      </DialogFooter>
    </>
  );
}

/** Edit dialog for an existing webhook's URL + subscribed events. */
export function EditWebhookDialog({
  webhookId,
  url,
  events,
  trigger,
}: {
  webhookId: string;
  url: string;
  events: readonly WebhookEventType[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateWebhookAction, editInitial);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit webhook</DialogTitle>
          <DialogDescription>Update the delivery URL or subscribed events.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="webhookId" value={webhookId} />
          <div className="space-y-1.5">
            <Label htmlFor={`webhook-url-${webhookId}`}>Delivery URL</Label>
            <Input
              id={`webhook-url-${webhookId}`}
              name="url"
              type="url"
              required
              autoComplete="off"
              defaultValue={url}
            />
          </div>
          <EventCheckboxes selected={events} />
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
