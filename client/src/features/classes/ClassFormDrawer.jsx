// src/features/classes/ClassFormDrawer.jsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { toast } from "sonner";

import { createClass } from "@/api/classes.api";
import { classSchema, toClassPayload } from "./classes.schema";
import { getErrorMessage } from "@/lib/errors";

export default function ClassFormDrawer({ children, defaultYear }) {
  const queryClient = useQueryClient();

  const form = useForm({
    resolver: zodResolver(classSchema),
    defaultValues: {
      name: "",
      stream: "",
      year: defaultYear || new Date().getFullYear(),
    },
    mode: "onChange",
  });

  const createMut = useMutation({
    mutationFn: createClass,
    onSuccess: () => {
      toast.success("Class created successfully");
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      form.reset({
        name: "",
        stream: "",
        year: defaultYear || new Date().getFullYear(),
      });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, "Failed to create class"));
    },
  });

  const isSubmitting = createMut.isPending;

  const onSubmit = (values) => {
    createMut.mutate(toClassPayload(values));
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
            <Label htmlFor="name">Class name</Label>
            <Input 
              id="name"
              placeholder="e.g. Grade 6 / Form 1" 
              {...form.register("name")} 
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="stream">Stream (optional)</Label>
            <Input 
              id="stream"
              placeholder="e.g. East / Blue" 
              {...form.register("stream")} 
            />
            {form.formState.errors.stream && (
              <p className="text-sm text-destructive">{form.formState.errors.stream.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Input 
              id="year"
              type="number" 
              {...form.register("year")} 
            />
            {form.formState.errors.year && (
              <p className="text-sm text-destructive">{form.formState.errors.year.message}</p>
            )}
          </div>

          {createMut.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              {getErrorMessage(createMut.error, "Failed to create class.")}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <SheetClose asChild>
              <Button type="button" variant="outline" className="flex-1">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" className="flex-1" disabled={isSubmitting || !form.formState.isValid}>
              {isSubmitting ? "Creating..." : "Create class"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}