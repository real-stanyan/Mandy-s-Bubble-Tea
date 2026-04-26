"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_PHOTOS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];

type Props = {
  orderId: string;
  pickupNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export function OrderComplaintFormDialog({
  orderId,
  pickupNumber,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setDescription("");
    setPhotos([]);
    setSubmitting(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return; // don't close mid-submit
    if (!next) reset();
    onOpenChange(next);
  }

  function pickPhotos(files: FileList | null) {
    if (!files) return;
    const errs: string[] = [];
    const accepted: File[] = [];
    for (const f of Array.from(files)) {
      if (!ALLOWED.includes(f.type)) {
        errs.push(`${f.name}: unsupported type`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        errs.push(`${f.name}: over 8 MB`);
        continue;
      }
      accepted.push(f);
    }
    const next = [...photos, ...accepted].slice(0, MAX_PHOTOS);
    setPhotos(next);
    if (errs.length) setError(errs.join(", "));
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (description.trim().length < 10) {
      setError("Please add a bit more detail (at least 10 characters).");
      return;
    }
    if (description.length > 1000) {
      setError("Description is too long (max 1000 characters).");
      return;
    }

    const fd = new FormData();
    fd.set("description", description.trim());
    photos.forEach((p) => fd.append("photos", p));

    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/complaint`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = json?.message || json?.error || `Server error (${res.status}).`;
        setError(String(msg));
        setSubmitting(false);
        return;
      }
      onSuccess();
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem with order {pickupNumber}</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. We&apos;ll be in touch within 24 hours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what went wrong (e.g. wrong topping, drink looked off, missing item)..."
              maxLength={1000}
              rows={5}
              className="rounded-tile border border-line bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
              required
            />
            <span className="text-right text-[11px] text-ink3">
              {description.length}/1000
            </span>
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-ink">
              Photos ({photos.length}/{MAX_PHOTOS}, optional)
            </span>
            {photos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="relative aspect-square overflow-hidden rounded-tile border border-line bg-white"
                  >
                    <img
                      src={URL.createObjectURL(p)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove ${p.name}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex items-center justify-center gap-2 rounded-tile border border-dashed border-line py-3 text-sm text-ink2 transition active:opacity-80"
              >
                <Upload size={14} />
                Add photo
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ALLOWED.join(",")}
              multiple
              onChange={(e) => {
                pickPhotos(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>

          {error && (
            <p className="rounded-tile border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
              className="rounded-tile border border-line px-4 py-2 text-sm text-ink2 transition active:opacity-80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-tile bg-brand px-4 py-2 text-sm font-medium text-white transition active:opacity-80 disabled:opacity-50"
            >
              {submitting && <Loader2 className="animate-spin" size={14} />}
              Submit
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
