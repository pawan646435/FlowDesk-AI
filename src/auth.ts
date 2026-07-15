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
    // JOIN_REQUEST_DESIGN.md §2.1 — supersedes MULTI_TENANCY_DESIGN.md §9.4's
    // deny-by-default gate. Previously rejected any Google account with no existing User
    // and no matching Invite, preventing PrismaAdapter from ever creating a User row for
    // them. Now allows any authenticated Google account through — a first-time sign-in
    // with no invite lands as a real, orgless User row instead of being rejected, and can
    // request access via the /onboarding join-request flow. Still rejects a missing
    // email: not part of what's being loosened, just a guard against a malformed/
    // misconfigured OAuth response (nothing downstream — User.email's unique constraint,
    // Invite/JoinRequest lookups by email — can function without one).
    async signIn({ user, profile }) {
      const email = profile?.email ?? user?.email;
      if (!email) return false;
      return true;
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
          // Brand-new user with no org yet. Previously could only reach this branch via
          // the signIn gate having already confirmed a valid Invite exists (§9.4's
          // deny-by-default). JOIN_REQUEST_DESIGN.md §2.1 loosened that gate, so this is
          // now a genuinely reachable, normal case too — a first-time sign-in with no
          // invite at all. The invite lookup below still matters (an invited user should
          // land pre-assigned to their org), it just no longer gates whether sign-in
          // succeeds in the first place.
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
            // No pending invite — genuinely reachable now (JOIN_REQUEST_DESIGN.md §2.1),
            // not the dead branch it used to be. Keep the token's shape consistent
            // (string | null, never undefined) rather than leaving it unset; the
            // /onboarding page (§3.2) is where this user lands next.
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
