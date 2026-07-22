import { z } from "zod";

export const teacherSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
});

export function toTeacherPayload(values) {
  return {
    email: values.email.trim().toLowerCase(),
    role: "TEACHER",
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
  };
}
