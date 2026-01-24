import { Button } from "@/components/ui/button";

export default function SimpleModal({ title, open, onClose, children, footer }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-[92vw] max-w-lg rounded-lg border bg-background p-4 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold">{title}</div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4">{children}</div>

        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>
    </div>
  );
}
