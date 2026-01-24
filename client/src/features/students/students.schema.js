import { z } from "zod";

export const studentSchema = z.object({
  admissionNo: z.string().trim().min(1, "Admission No is required"),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.string().trim().optional().or(z.literal("")),
  dob: z.string().trim().optional().or(z.literal("")), // yyyy-mm-dd
  classId: z.string().trim().optional().or(z.literal("")),
});

export function toStudentPayload(values) {
  return {
    admissionNo: values.admissionNo.trim(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    gender: values.gender ? values.gender.trim() : null,
    dob: values.dob ? values.dob : null,
    classId: values.classId ? values.classId : null,
  };
}
