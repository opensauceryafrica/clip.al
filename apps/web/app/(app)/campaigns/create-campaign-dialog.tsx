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
  Input,
  Label,
  Textarea,
} from '@clipal/ui';
import { Plus } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import type { FormActionState } from '@/lib/action-state';
import { createCampaignAction } from './actions';

const initialState: FormActionState = {};

export function CreateCampaignDialog({
  triggerLabel = 'New campaign',
  variant = 'primary',
}: {
  triggerLabel?: string;
  variant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createCampaignAction, initialState);

  // Close + reset once the action reports success. `state.ok` flips on the
  // server round-trip; we clear it implicitly by closing (next open re-mounts).
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Group links into an A/B test or a tracked campaign.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">Name</Label>
            <Input
              id="campaign-name"
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="Spring launch"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-notes">Notes (optional)</Label>
            <Textarea
              id="campaign-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              placeholder="What are you testing?"
            />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Creating…' : 'Create campaign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
