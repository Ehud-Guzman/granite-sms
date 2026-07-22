let resolveFn = null;
let setStateFn = null;

export const initialConfirmState = {
  open: false,
  title: "",
  description: "",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  variant: "default",
};

export function registerConfirmSetState(fn) {
  setStateFn = fn;
}

export function settleConfirm(value) {
  resolveFn?.(value);
  resolveFn = null;
}

/**
 * Promise-based replacement for window.confirm(), styled to match the app.
 * Usage: if (await confirmAction({ title: "Deactivate teacher?", description: "..." })) { ... }
 */
export function confirmAction({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    resolveFn = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    setStateFn?.({ open: true, title, description, confirmLabel, cancelLabel, variant });
  });
}
