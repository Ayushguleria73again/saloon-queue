import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.activeOrganizationId = user.activeOrganizationId;
        token.sessionVersion = user.sessionVersion;
        token.isPlatformAdmin = user.isPlatformAdmin;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId;
        session.user.activeOrganizationId = token.activeOrganizationId ?? null;
        session.user.sessionVersion = token.sessionVersion ?? 1;
        session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin);
      }
      return session;
    },
  },
};
