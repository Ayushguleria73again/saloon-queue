import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { loginSchema } from "@/features/auth/schemas";
import { extractClientIp, hashIpAddress } from "@/server/security/ip";
import { authConfig } from "./auth.config";
import { authenticateWithCredentials } from "./login-service";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, request) {
        const parsed = loginSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const clientIp = request ? extractClientIp(request.headers) : "127.0.0.1";
        const ipAddressHash = process.env.IP_HASH_SALT
          ? hashIpAddress(clientIp, process.env.IP_HASH_SALT)
          : undefined;
        const userAgent = request?.headers.get("user-agent") ?? undefined;

        const result = await authenticateWithCredentials({
          email: parsed.data.email,
          password: parsed.data.password,
          ipAddressHash,
          userAgent,
        });

        if (!result.ok) {
          return null;
        }

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          activeOrganizationId: result.user.activeOrganizationId,
          sessionVersion: result.user.sessionVersion,
          isPlatformAdmin: result.user.isPlatformAdmin,
        };
      },
    }),
  ],
});
