// Adds a charge to an existing invoice mid-term (trip, uniform, exam fee).
// Any credit on the learner's account is used on it automatically.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/api/axios";
import { listFeeItems } from "@/api/fees.api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AddChargeForm({ invoiceId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [feeItemId, setFeeItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const itemsQ = useQuery({ queryKey: ["feeItems"], queryFn: listFeeItems, enabled: open });

  const add = useMutation({
    mutationFn: () => api.post(`/api/fees/invoices/${invoiceId}/lines`, { feeItemId, amount: Number(amount), note: note || undefined }),
    onSuccess: () => {
      toast.success("Charge added");
      setOpen(false);
      setFeeItemId("");
      setAmount("");
      setNote("");
      onAdded?.();
    },
    onError: (e) => toast.error(e?.response?.data?.message || "Could not add the charge"),
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add charge
      </Button>
    );
  }
  const items = (Array.isArray(itemsQ.data) ? itemsQ.data : []).filter((i) => i.isActive !== false);
  return (
    <div className="grid gap-2 sm:grid-cols-4 items-end rounded-md border p-2">
      <select
        aria-label="Fee item"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={feeItemId}
        onChange={(e) => setFeeItemId(e.target.value)}
      >
        <option value="">Fee item…</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
      <Input aria-label="Amount" type="number" min={1} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!feeItemId || !(Number(amount) > 0) || add.isPending} onClick={() => add.mutate()}>
          Add
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
