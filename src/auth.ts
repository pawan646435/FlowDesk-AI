import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import authConfig from "./auth.config";
import type { OrganizationRole } from "@prisma/client";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  ...authConfig,
  callbacks: {
    // MULTI_TENANCY_DESIGN.md §9.4 — the gate that prevents PrismaAdapter from ever
    // creating a User row in the first place. Fires before any DB write for a new
    // sign-in: returning false here stops the flow before `createUser` runs, which is
    // why this check lives here and not in `jwt` below (by the time `jwt` fires with a
    // populated `user`, the adapter has already created the row — too late to prevent it).
    async signIn({ user, profile }) {
      const email = profile?.email ?? user?.email;
      if (!email) return false;

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return true; // returning user, always allowed back in

      const validInvite = await prisma.invite.findFirst({
        where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
      });
      return !!validInvite; // false -> Auth.js redirects to /login with an error, no User row is created
    },
    // MULTI_TENANCY_DESIGN.md §2.2, extended by §9.3 (invite consumption) and §9.6 (role).
    // `user` is only populated on the initial sign-in call, never on token refresh.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;

        if (user.organizationId) {
          // Returning user who already belongs to an org.
          token.organizationId = user.organizationId;
          token.role = user.role ?? null;
        } else if (user.email) {
          // Brand-new user with no org yet — can only reach this state via the signIn
          // gate above, which already confirmed a valid Invite exists for this email.
          const invite = await prisma.invite.findFirst({
            where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
          });

          if (invite) {
            // §9.6: wrap the org/role assignment and invite consumption in a transaction
            // so they succeed or fail together.
            const [updatedUser] = await prisma.$transaction([
              prisma.user.update({
                where: { id: user.id },
                data: { organizationId: invite.organizationId, role: invite.role },
              }),
              prisma.invite.update({
                where: { id: invite.id },
                data: { acceptedAt: new Date() },
              }),
            ]);
            token.organizationId = updatedUser.organizationId;
            token.role = updatedUser.role;
          } else {
            // Should be unreachable given the signIn gate, but keep the token's shape
            // consistent (string | null, never undefined) rather than leaving it unset.
            token.organizationId = null;
            token.role = null;
          }
        }
      }
      return token;
    },
    // MULTI_TENANCY_DESIGN.md §2.3, extended by §9.6 (role). The jwt/signIn callbacks
    // above get full type safety from src/types/next-auth.d.ts with no casts needed —
    // this callback still needs them because @auth/core types `session`'s params as an
    // intersection of the JWT-strategy and database-strategy shapes, which collapses
    // `token`'s inferred type to `{}` on destructure regardless of augmentation. This
    // mirrors the pre-existing `token.id as string` cast already used here before this
    // change, extended to the two new fields rather than newly introduced by it.
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.organizationId = token.organizationId as string | null;
        session.user.role = token.role as OrganizationRole | null;
      }
      return session;
    },
  },
});
