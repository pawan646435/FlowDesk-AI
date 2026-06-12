import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  
  // WhatsApp Configuration
  WHATSAPP_ACCESS_TOKEN: z.string().min(1, "WHATSAPP_ACCESS_TOKEN is required"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "WHATSAPP_PHONE_NUMBER_ID is required"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1, "WHATSAPP_BUSINESS_ACCOUNT_ID is required"),
  WHATSAPP_APP_SECRET: z.string().min(1, "WHATSAPP_APP_SECRET is required"),
});

export function validateConfig() {
  const result = configSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  });

  if (!result.success) {
    const errorMessages = result.error.issues.map((err: z.ZodIssue) => `  - ${err.path.join(".")}: ${err.message}`).join("\n");
    const header = "\n==================================================\n⚠️ CONFIGURATION ERROR: MISSING REQUIRED ENVIRONMENT VARIABLES\n==================================================\n";
    const footer = "\n==================================================\n";
    const errorMessage = `${header}${errorMessages}${footer}`;
    
    if (process.env.NODE_ENV === "production") {
      throw new Error(errorMessage);
    } else {
      console.error(errorMessage);
    }
  } else {
    console.log("[Config] Configuration validation passed.");
  }
}

// Run validation immediately on module load
validateConfig();

export const config = {
  databaseUrl: process.env.DATABASE_URL || "",
  authSecret: process.env.AUTH_SECRET || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || "",
};
