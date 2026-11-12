import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(
  password: string,
  cost: number = BCRYPT_COST,
): Promise<string> {
  return bcrypt.hash(password, cost);
}

function verifyScryptHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) {
    return false;
  }

  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (expectedBuf.length === 0) {
    return false;
  }

  const derivedBuf = crypto.scryptSync(password, salt, expectedBuf.length);
  if (derivedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedBuf, expectedBuf);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  if (storedHash.startsWith("scrypt:")) {
    return verifyScryptHash(password, storedHash);
  }

  if (
    storedHash.startsWith("$2a$") ||
    storedHash.startsWith("$2b$") ||
    storedHash.startsWith("$2y$")
  ) {
    return bcrypt.compare(password, storedHash);
  }

  return false;
}
