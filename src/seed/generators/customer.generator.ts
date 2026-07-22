import type { Customer, Prisma } from "../../../generated/prisma";
import type { SeedConfig } from "../config";
import {
  batchCreateManyAndReturn,
  chance,
  type Db,
  faker,
  randomInt,
  sampleUnique,
  uniqueEmail,
  uniqueIndianMobile,
} from "../utils";

export interface CustomerSeedResult {
  customers: Customer[];
  /** Ids of the ~frequentCustomerRatio slice bill.generator.ts (Phase 7) should bias repeat bills toward. */
  frequentCustomerIds: number[];
}

const CHENNAI_AREAS = [
  "Anna Nagar", "Velachery", "T Nagar", "Adyar", "Mylapore", "Nungambakkam", "Perambur",
  "Tambaram", "Porur", "Guindy", "Kilpauk", "Vadapalani", "Ashok Nagar", "Saidapet",
  "Besant Nagar", "Kodambakkam", "Royapettah", "Egmore", "Chromepet", "Alwarpet",
];

const EMAIL_DOMAINS = ["gmail.com", "yahoo.in", "outlook.com", "rediffmail.com", "hotmail.com"];

function randomAddress(): string {
  const area = faker.helpers.arrayElement(CHENNAI_AREAS);
  return `${randomInt(1, 200)}, ${faker.helpers.arrayElement(["Main Road", "Cross Street", "1st Street", "2nd Street", "Avenue Road"])}, ${area}, Chennai`;
}

/**
 * Owns: Customer (config.counts.customers, Chennai-style names/phones).
 * config.counts.frequentCustomerRatio of the returned rows are tagged (via
 * the returned id list, not a schema field — Customer has no "isFrequent"
 * column) as repeat visitors for bill.generator.ts to bias multiple bills
 * toward.
 *
 * Idempotent: generates once per restaurant (check-first, like ingredients/
 * menu items) rather than duplicating on every plain `npm run seed`.
 */
export async function generateCustomers(db: Db, config: SeedConfig, restaurantId: number): Promise<CustomerSeedResult> {
  const existing = await db.customer.findMany({ where: { restaurantId } });
  if (existing.length > 0) {
    const frequentCustomerIds = sampleUnique(
      existing,
      Math.round(existing.length * config.counts.frequentCustomerRatio),
    ).map((c) => c.id);
    return { customers: existing, frequentCustomerIds };
  }

  const rows: Prisma.CustomerCreateManyInput[] = [];
  for (let i = 0; i < config.counts.customers; i++) {
    const name = `${faker.person.firstName()} ${faker.person.lastName()}`;
    rows.push({
      name,
      phone: uniqueIndianMobile(),
      email: chance(0.6) ? uniqueEmail(name, EMAIL_DOMAINS) : null,
      address: chance(0.7) ? randomAddress() : null,
      restaurantId,
    });
  }

  const customers = await batchCreateManyAndReturn(rows, (chunk) => db.customer.createManyAndReturn({ data: chunk }));
  const frequentCustomerIds = sampleUnique(
    customers,
    Math.round(customers.length * config.counts.frequentCustomerRatio),
  ).map((c) => c.id);

  return { customers, frequentCustomerIds };
}
