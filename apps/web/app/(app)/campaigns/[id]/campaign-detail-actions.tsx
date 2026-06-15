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
import { Pencil, Trash2 } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import type { FormActionState } from '@/lib/action-state';
import { deleteCampaignAction, renameCampaignAction } from '../actions';

const initialState: FormActionState = {};

export function CampaignDetailActions({
  campaignId,
  name,
  notes,
  linkCount,
}: {
  campaignId: string;
  name: string;
  notes: string;
  linkCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <RenameCampaignDialog campaignId={campaignId} name={name} notes={notes} />
      <DeleteCampaignDialog campaignId={campaignId} name={name} linkCount={linkCount} />
    </div>
  );
}

function RenameCampaignDialog({
  campaignId,
  name,
  notes,
}: {
  campaignId: string;
  name: string;
  notes: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(renameCampaignAction, initialState);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Pencil className="size-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit campaign</DialogTitle>
          <DialogDescription>Rename this campaign or update its notes.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaignId} />
          <div className="space-y-1.5">
            <Label htmlFor="rename-name">Name</Label>
            <Input
              id="rename-name"
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={name}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-notes">Notes (optional)</Label>
            <Textarea
              id="rename-notes"
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={notes}
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
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCampaignDialog({
  campaignId,
  name,
  linkCount,
}: {
  campaignId: string;
  name: string;
  linkCount: number;
}) {
  const hasLinks = linkCount > 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="text-destructive">
          <Trash2 className="size-4" />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete campaign</DialogTitle>
          <DialogDescription>
            {hasLinks ? (
              <>
                <span className="font-medium text-foreground">{name}</span> still has{' '}
                {linkCount} link{linkCount === 1 ? '' : 's'} assigned. Deleting it will detach
                {linkCount === 1 ? ' that link' : ' those links'} (the links themselves are kept).
                This cannot be undone.
              </>
            ) : (
              <>
                Permanently delete{' '}
                <span className="font-medium text-foreground">{name}</span>? This cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {/* mode=detach forces the server action to clear campaign_id on any
            assigned links before deleting, instead of blocking. */}
        <form action={deleteCampaignAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="mode" value="detach" />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" variant="destructive">
              {hasLinks ? 'Detach & delete' : 'Delete campaign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
