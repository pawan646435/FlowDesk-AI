import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

console.log("[AuthConfig] Google Client ID:", process.env.AUTH_GOOGLE_ID ? "Exists" : "MISSING");
console.log("[AuthConfig] Google Client Secret:", process.env.AUTH_GOOGLE_SECRET ? "Exists" : "MISSING");
console.log("[AuthConfig] Auth Secret:", process.env.AUTH_SECRET ? "Exists" : "MISSING");

export default {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
