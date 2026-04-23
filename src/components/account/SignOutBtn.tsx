"use client";

type SignOutBtnProps = {
  onSignOut: () => void | Promise<void>;
};

export function SignOutBtn({ onSignOut }: SignOutBtnProps) {
  return (
    <div className="px-4 mt-5">
      <button
        type="button"
        onClick={onSignOut}
        className="w-full rounded-card border border-line bg-paper py-3 text-ink transition active:bg-cream"
        style={{ fontSize: 14, fontWeight: 500 }}
      >
        Sign out
      </button>
    </div>
  );
}
