/**
 * Customer contact details are masked unless the caller holds
 * CUSTOMER_PII_VIEW.
 *
 * The masking happens in the service layer, on the way out of the database —
 * not in the frontend. If the API returned the full number and the UI merely
 * displayed dots, the real value would still be sitting in the network response
 * for anyone who opened developer tools, which is exactly the "frontend hiding
 * is not a security mechanism" failure the brief calls out.
 *
 * Enough of each value survives that support can still confirm a match against
 * what a caller reads out ("does it end 4821?") without the record itself being
 * readable.
 */

export const maskPhone = (phone?: string | null): string | null => {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  return `${"•".repeat(Math.max(2, digits.length - 4))}${digits.slice(-4)}`;
};

export const maskEmail = (email?: string | null): string | null => {
  if (!email) return email ?? null;
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
};

export const maskAddress = (address?: string | null): string | null => {
  if (!address) return address ?? null;
  // Keep only the last comma-separated component (usually the locality/city),
  // which is what an agent needs for context, and drop the street line.
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return "•••";
  return `•••, ${parts[parts.length - 1]}`;
};

export const maskName = (name?: string | null): string | null => {
  if (!name) return name ?? null;
  const parts = name.trim().split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p : `${p.slice(0, 1)}.`)).join(" ");
};

export interface ContactFields {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

/**
 * Returns the contact block for a customer-shaped record, plus an explicit
 * `piiMasked` flag so the UI can label what it is showing instead of silently
 * presenting a masked value as the real one.
 */
export const applyContactMasking = <T extends ContactFields>(record: T, canViewPii: boolean) => {
  if (canViewPii) return { ...record, piiMasked: false };
  return {
    ...record,
    name: record.name ?? null,
    phone: maskPhone(record.phone),
    email: maskEmail(record.email),
    address: maskAddress(record.address),
    piiMasked: true,
  };
};
