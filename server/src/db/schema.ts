import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

/** PostgreSQL BYTEA */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver(value: Buffer): Buffer {
    return value;
  },
});

export interface EducationRow {
  institution: string;
  title: string;
  type: string;
  year?: string;
}

export interface LanguageRow {
  language: string;
  level: string;
}

/**
 * Referencia mínima a `public.users` para FKs en Drizzle.
 * No generes migración que cree esta tabla si ya existe en tu base.
 */
export const users = pgTable("users", {
  id: integer("id").primaryKey(),
});

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  professionalTitle: varchar("professional_title", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }).notNull(),
  location: varchar("location", { length: 255 }).notNull(),
  education: jsonb("education").$type<EducationRow[]>().notNull().default([]),
  languages: jsonb("languages").$type<LanguageRow[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobPreferences = pgTable("job_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  salaryExpectation: varchar("salary_expectation", { length: 64 }),
  salaryCurrency: varchar("salary_currency", { length: 3 }).notNull().default("USD"),
  roles: text("roles").array().notNull().default([]),
  modality: text("modality").array().notNull().default([]),
  employmentType: text("employment_type").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerSessions = pgTable(
  "provider_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    storageStateEncrypted: bytea("storage_state_encrypted").notNull(),
    encryptionKeyId: varchar("encryption_key_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("provider_sessions_user_provider_unique").on(t.userId, t.provider),
  ],
);
