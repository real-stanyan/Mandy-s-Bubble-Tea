export const COMPLAINT_WINDOW_DAYS = 7;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const PHOTO_MAX_COUNT = 3;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
] as const;

export function isWithinComplaintWindow(
  closedAt: string | null,
  now: Date,
): boolean {
  if (!closedAt) return false;
  const closed = new Date(closedAt).getTime();
  if (Number.isNaN(closed)) return false;
  const ageMs = now.getTime() - closed;
  return ageMs < COMPLAINT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function ownsOrder(
  sessionCustomerId: string | null,
  orderCustomerId: string | null,
): boolean {
  if (!sessionCustomerId || !orderCustomerId) return false;
  return sessionCustomerId === orderCustomerId;
}

export type ValidateBodyInput = {
  description: string;
  photoCount: number;
};

export type ValidateBodyResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "DESCRIPTION_TOO_SHORT"
        | "DESCRIPTION_TOO_LONG"
        | "TOO_MANY_PHOTOS"
        | "INVALID_PHOTO_COUNT";
      message: string;
    };

export function validateComplaintBody(
  input: ValidateBodyInput,
): ValidateBodyResult {
  const desc = input.description?.trim() ?? "";
  if (desc.length < DESCRIPTION_MIN) {
    return {
      ok: false,
      code: "DESCRIPTION_TOO_SHORT",
      message: `Description must be at least ${DESCRIPTION_MIN} characters.`,
    };
  }
  if (desc.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      code: "DESCRIPTION_TOO_LONG",
      message: `Description must be ${DESCRIPTION_MAX} characters or fewer.`,
    };
  }
  if (input.photoCount < 0) {
    return {
      ok: false,
      code: "INVALID_PHOTO_COUNT",
      message: "Photo count cannot be negative.",
    };
  }
  if (input.photoCount > PHOTO_MAX_COUNT) {
    return {
      ok: false,
      code: "TOO_MANY_PHOTOS",
      message: `At most ${PHOTO_MAX_COUNT} photos.`,
    };
  }
  return { ok: true };
}
