import { z } from "zod";

export const classSchema = z.object({
  name: z.string().trim().min(1, "Class name is required"),
  stream: z.string().trim().optional().or(z.literal("")),
  year: z.coerce.number().int().min(2000).max(2100),
});

export function toClassPayload(values) {
  return {
    name: values.name.trim(),
    stream: values.stream ? values.stream.trim() : null,
    year: values.year,
  };
}
