import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "@auth/core/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    name: string;
    activeOrganizationId: string | null;
    sessionVersion: number;
    isPlatformAdmin: boolean;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      email: string;
      name: string;
      activeOrganizationId: string | null;
      sessionVersion: number;
      isPlatformAdmin: boolean;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT extends DefaultJWT {
    userId?: string;
    activeOrganizationId?: string | null;
    sessionVersion?: number;
    isPlatformAdmin?: boolean;
  }
}
