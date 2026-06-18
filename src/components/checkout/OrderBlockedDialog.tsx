"use client";

import { BRAND } from "@/lib/constants";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Shown when /api/orders rejects an order on a delivery eligibility gate
// (minimum order, hours, zone, missing address). Unlike PaymentErrorDialog
// these aren't payment failures — there's no point retrying the same order,
// so we offer the actions that actually unblock it: add more drinks or switch
// to pickup.
export function OrderBlockedDialog({
  open,
  title,
  body,
  onAddItems,
  onSwitchToPickup,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  onAddItems?: () => void;
  onSwitchToPickup?: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="text-center sm:text-center">
          <AlertDialogTitle className="text-center">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          {onAddItems && (
            <AlertDialogAction
              onClick={onAddItems}
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Add more items
            </AlertDialogAction>
          )}
          {onSwitchToPickup && (
            <AlertDialogCancel onClick={onSwitchToPickup} className="mt-0">
              Switch to pickup
            </AlertDialogCancel>
          )}
          <AlertDialogCancel onClick={onCancel} className="mt-0">
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
