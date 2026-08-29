import crypto from "crypto";

/**
 * RFC 6238 TOTP, implemented directly on node:crypto.
 *
 * Written out rather than pulled from a package because it is about forty lines
 * of standard HMAC and this codebase has no 2FA dependency today — adding one
 * to the restaurant backend's dependency tree for the internal console's sake
 * isn't a trade worth making. Interoperates with Google Authenticator, Authy
 * and 1Password, which all implement the same spec with these defaults.
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
const PERIOD_SECONDS = 30;
// One step either side of now: enough for a phone whose clock has drifted a
// few seconds, without meaningfully widening the window for a guessed code.
const DRIFT_STEPS = 1;

export const generateSecret = (byteLength = 20): string => base32Encode(crypto.randomBytes(byteLength));

export const base32Encode = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += B32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = B32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const hotp = (secret: Buffer, counter: number): string => {
  const buf = Buffer.alloc(8);
  // Counter is a 64-bit big-endian integer. writeBigUInt64BE keeps it exact
  // above 2^53, which a plain number pair would not.
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
};

export const generateTotp = (secretBase32: string, atMs = Date.now()): string =>
  hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / PERIOD_SECONDS));

export const verifyTotp = (secretBase32: string, code: string, atMs = Date.now()): boolean => {
  const candidate = (code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return false;
  const secret = base32Decode(secretBase32);
  const step = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const expected = hotp(secret, step + drift);
    // Constant-time compare so a wrong code can't be narrowed down by timing.
    if (
      expected.length === candidate.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))
    ) {
      return true;
    }
  }
  return false;
};

/** The otpauth:// URI an authenticator app scans. */
export const buildOtpAuthUrl = (secretBase32: string, accountEmail: string, issuer = "DineInk Internal") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}` +
  `?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
