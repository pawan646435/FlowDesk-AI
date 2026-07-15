import { z } from "zod";

export const createTicketSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters long")
    .max(100, "Title cannot exceed 100 characters"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters long"),
  isHighPriority: z.boolean().optional(),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;

export const createOrganizationSchema = z.object({
  orgName: z
    .string()
    .min(2, "Organization name must be at least 2 characters long")
    .max(100, "Organization name cannot exceed 100 characters"),
  email: z.string().email("Enter a valid email address"),
});

export const sendInviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type SendInviteInput = z.infer<typeof sendInviteSchema>;

// Empty string means "not configured" (cleared), so it's allowed alongside a valid URL.
const optionalUrl = z.union([z.literal(""), z.string().url("Enter a valid URL")]);

export const webhookConfigSchema = z.object({
  newTicketUrl: optionalUrl,
  escalationUrl: optionalUrl,
  negativeSentimentUrl: optionalUrl,
  resolutionUrl: optionalUrl,
  slaBreachUrl: optionalUrl,
});

export type WebhookConfigFormInput = z.infer<typeof webhookConfigSchema>;
