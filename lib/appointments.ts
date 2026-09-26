import { z } from "zod";

export const appointmentSchema = z.object({
  id: z.string().uuid(),
  revision: z.string().uuid().optional(),
  at: z.string().datetime(), // future allowed
  title: z.string().trim().min(1).max(120),
  location: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000),
});
export type Appointment = z.infer<typeof appointmentSchema>;
