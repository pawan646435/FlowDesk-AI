import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;

  const isDashboard = nextUrl.pathname.startsWith("/dashboard");
  const isTickets = nextUrl.pathname.startsWith("/tickets");

  if (isDashboard || isTickets) {
    if (!isLoggedIn) {
      // Redirect to login page
      return Response.redirect(new URL("/login", nextUrl));
    }
  }

  if (nextUrl.pathname === "/login") {
    if (isLoggedIn) {
      // Redirect to dashboard page if already logged in
      return Response.redirect(new URL("/dashboard", nextUrl));
    }
  }

  return;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
