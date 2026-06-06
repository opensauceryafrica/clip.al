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
} from '@clipal/ui';
import { Trash2 } from 'lucide-react';
import { deleteLinkAction, setLinkStatusAction } from '@/app/(app)/links/[id]/actions';

export function LinkDetailActions({ linkId, status }: { linkId: string; status: string }) {
  const isDisabled = status !== 'active';
  // The owner can't re-enable links an admin or the safety system turned off.
  const lockedOff = status === 'disabled_by_admin' || status === 'disabled_by_safety';

  return (
    <div className="flex items-center gap-2">
      {!lockedOff && (
        <form action={setLinkStatusAction}>
          <input type="hidden" name="linkId" value={linkId} />
          <input type="hidden" name="action" value={isDisabled ? 'enable' : 'disable'} />
          <Button type="submit" variant="secondary" size="sm">
            {isDisabled ? 'Enable' : 'Disable'}
          </Button>
        </form>
      )}

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
            <Trash2 /> Delete
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this link?</DialogTitle>
            <DialogDescription>
              This permanently removes the link and its reports. The short URL will stop working.
              This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <form action={deleteLinkAction}>
              <input type="hidden" name="linkId" value={linkId} />
              <Button type="submit" variant="destructive">
                Delete link
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
