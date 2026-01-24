// src/features/classes/ClassFormDrawer.jsx
import { useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { useClasses } from "./classes.queries";


const schema = z.object({
  name: z.string().trim().min(1, "Class name is required"),
  stream: z.string().trim().optional().or(z.literal("")),
  year: z.coerce.number().int().min(2000).max(2100),
});

export default function ClassFormDrawer({ children, defaultYear }) {
  const createMut = useClasses();

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      stream: "",
      year: defaultYear || new Date().getFullYear(),
    },
  });

  const isSubmitting = createMut.isPending;

  useEffect(() => {
    if (createMut.isSuccess) {
      form.reset({
        name: "",
        stream: "",
        year: defaultYear || new Date().getFullYear(),
      });
    }
  }, [createMut.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values) => {
    await createMut.mutateAsync({
      name: values.name,
      stream: values.stream || null,
      year: values.year,
    });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>

      <SheetContent side="right" className="w-[420px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle>Create Class</SheetTitle>
        </SheetHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label>Class name</Label>
            <Input placeholder="e.g. Grade 6 / Form 1" {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Stream (optional)</Label>
            <Input placeholder="e.g. East / Blue" {...form.register("stream")} />
            {form.formState.errors.stream && (
              <p className="text-sm text-destructive">{form.formState.errors.stream.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Year</Label>
            <Input type="number" {...form.register("year")} />
            {form.formState.errors.year && (
              <p className="text-sm text-destructive">{form.formState.errors.year.message}</p>
            )}
          </div>

          {createMut.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              {createMut.error?.response?.data?.message || "Failed to create class."}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create class"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
