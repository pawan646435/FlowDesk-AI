import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/navbar";
import { getVerifiedSession } from "@/lib/session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlowDesk AI | Modern Customer Support Platform",
  description: "Manage, track, and resolve customer support queries in real time with our production-ready ticketing dashboard.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // DB-verified, not the raw JWT cookie — a removed/left/switched user's session must
  // stop rendering as "logged in" here too, not just in each protected page's own body.
  // navbar.tsx previously used next-auth/react's useSession() (client-side, cookie-only,
  // no DB check), which kept showing a removed user's name/avatar/Sign Out button even
  // after their next-page-load redirect to /login correctly fired for the page content
  // itself — two separate session sources disagreeing. Passing the verified session down
  // as a prop here means Navbar no longer needs its own session source at all.
  //
  // requireOrg: false — JOIN_REQUEST_DESIGN.md §1.2's finding: without this, an
  // authenticated-but-orgless user (the new /onboarding state) would resolve to null here
  // and the navbar would render as fully signed-out, even though they have a real,
  // DB-backed session. Every existing behavior for a genuinely unauthenticated visitor
  // (session is null, Navbar returns null) is unchanged.
  const session = await getVerifiedSession({ onStale: "unauthorized", requireOrg: false });

  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background text-foreground`}
      >
        <Providers>
          <div className="relative flex min-h-screen flex-col">
            <Navbar session={session} />
            <main className="flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
