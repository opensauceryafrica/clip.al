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
} from '@clipal/ui';
import { Plus } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import {
  createAdPlacementAction,
  updateAdPlacementAction,
  type AdActionState,
} from '@/app/(admin)/actions';

const initial: AdActionState = {};

const AD_SLOTS = [
  { value: 'interstitial_top', label: 'Interstitial — top' },
  { value: 'interstitial_bottom', label: 'Interstitial — bottom' },
  { value: 'tree_top', label: 'Link tree — top' },
] as const;

export type AdSlot = (typeof AD_SLOTS)[number]['value'];

/** Fields rendered for both create and edit. */
export interface AdFormDefaults {
  id: string;
  slot: AdSlot;
  advertiserName: string;
  clickUrl: string;
  weight: number;
  active: boolean;
  /** Pre-formatted `YYYY-MM-DDTHH:mm` for datetime-local, or '' if unset. */
  startsAt: string;
  endsAt: string;
  /** Current creative public URL, for the preview thumbnail (edit only). */
  imagePreviewUrl: string;
}

const SELECT_CLASS =
  'h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Shared create/edit dialog for an ad placement. In edit mode (`defaults`
 * present) the action is `updateAdPlacementAction` with a hidden `id` and the
 * creative upload is optional — leaving the file empty keeps the existing
 * creative. The chosen file is previewed client-side via an object URL.
 */
export function AdFormDialog({
  defaults,
  trigger,
}: {
  defaults?: AdFormDefaults;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(defaults);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateAdPlacementAction : createAdPlacementAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  // Close + reset on success.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      if (!isEdit) formRef.current?.reset();
      setLocalPreview(null);
    }
  }, [state.ok, isEdit]);

  // Revoke any object URL we created when it changes / unmounts.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (localPreview) URL.revokeObjectURL(localPreview);
    const file = e.target.files?.[0];
    setLocalPreview(file ? URL.createObjectURL(file) : null);
  }

  const previewSrc = localPreview ?? defaults?.imagePreviewUrl ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" />
            New placement
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit placement' : 'New placement'}</DialogTitle>
          <DialogDescription>
            House ad served in a named slot. Weighted random selection runs over the active
            placements for each slot.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={defaults?.id} /> : null}

          <div className="space-y-1.5">
            <Label htmlFor="ad-slot">Slot</Label>
            <select
              id="ad-slot"
              name="slot"
              defaultValue={defaults?.slot ?? 'interstitial_top'}
              className={SELECT_CLASS}
            >
              {AD_SLOTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-advertiser">Advertiser name</Label>
            <Input
              id="ad-advertiser"
              name="advertiserName"
              required
              maxLength={120}
              autoComplete="off"
              defaultValue={defaults?.advertiserName ?? ''}
              placeholder="Acme Inc."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-click-url">Click URL</Label>
            <Input
              id="ad-click-url"
              name="clickUrl"
              type="url"
              required
              autoComplete="off"
              defaultValue={defaults?.clickUrl ?? ''}
              placeholder="https://example.com/landing"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ad-image">
              Creative {isEdit ? <span className="text-muted-foreground">(optional)</span> : null}
            </Label>
            <input
              id="ad-image"
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              required={!isEdit}
              onChange={onFileChange}
              className="block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-accent"
            />
            <p className="text-xs text-muted-foreground">
              PNG, JPEG, WebP, GIF, or SVG · up to 2 MB.
            </p>
            {previewSrc ? (
              <div className="mt-2 overflow-hidden rounded-md border border-border bg-muted">
                <img
                  src={previewSrc}
                  alt="Creative preview"
                  className="max-h-40 w-full object-contain"
                />
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ad-weight">Weight</Label>
              <Input
                id="ad-weight"
                name="weight"
                type="number"
                min={1}
                max={1000}
                step={1}
                defaultValue={defaults?.weight ?? 1}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="active"
                defaultChecked={defaults?.active ?? true}
                className="size-4 cursor-pointer accent-foreground"
              />
              Active
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ad-starts">Starts at</Label>
              <Input
                id="ad-starts"
                name="startsAt"
                type="datetime-local"
                defaultValue={defaults?.startsAt ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-ends">Ends at</Label>
              <Input
                id="ad-ends"
                name="endsAt"
                type="datetime-local"
                defaultValue={defaults?.endsAt ?? ''}
              />
            </div>
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {pending
                ? isEdit
                  ? 'Saving…'
                  : 'Creating…'
                : isEdit
                  ? 'Save changes'
                  : 'Create placement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
