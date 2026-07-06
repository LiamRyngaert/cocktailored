import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// NOTE: this schema mirrors a pre-existing, populated Hetzner Postgres
// database (real customer data — quiz sessions, ingredients, reviews, GDPR
// consent records). Column names below use drizzle's DB-name override
// (e.g. `varchar("session_id")`) so the JS-side property names stay
// camelCase for the rest of the app while matching the real snake_case
// columns already in the database. Do NOT rename/drop real columns here —
// the `cocktailored` app DB user does not own these tables (owned by
// `postgres`), so DDL changes must happen out-of-band, not via this schema.

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 16 }).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Quiz sessions — stores all answers and generated recipes
export const quizSessions = pgTable("quiz_sessions", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 64 }).notNull().unique(),
  guestName: varchar("name", { length: 128 }),
  guestEmail: varchar("email", { length: 320 }),
  ipAddress: varchar("ip_address", { length: 64 }),
  deviceType: varchar("device_type", { length: 32 }),
  country: varchar("country", { length: 64 }),
  answers: jsonb("answers").notNull(), // Array of {questionId, question, answer}
  flavorProfile: jsonb("flavor_profile"), // Derived flavor profile object
  recipes: jsonb("generated_recipes"), // Array of 3 generated cocktail recipes
  selectedRecipeIndex: integer("selected_recipe_index").default(0),
  allergies: text("allergies"),
  isCustom: boolean("is_custom").default(false),
  // Order inquiry fields
  orderEmail: varchar("order_email", { length: 320 }),
  orderPhone: varchar("order_phone", { length: 64 }),
  orderSubmitted: boolean("order_submitted").default(false).notNull(),
  webhookSent: boolean("webhook_sent").default(false).notNull(),
  webhookSentAt: timestamp("webhook_sent_at"),
  // Real schema tracks completion via a nullable timestamp, not a boolean.
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Admin list orders by newest first and filters to submitted orders.
  createdAtIdx: index("quiz_sessions_created_at_idx").on(t.createdAt),
  orderSubmittedIdx: index("quiz_sessions_order_submitted_idx").on(t.orderSubmitted),
}));

export type QuizSession = typeof quizSessions.$inferSelect;
export type InsertQuizSession = typeof quizSessions.$inferInsert;

// GDPR consent audit trail — a separate table (not columns on quiz_sessions)
// so consent records are immutable and independently auditable.
export const consentRecords = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }),
  consentMarketing: boolean("consent_marketing").default(false),
  consentThirdParty: boolean("consent_third_party").default(false),
  consentTimestamp: timestamp("consent_timestamp"),
  consentIp: varchar("consent_ip", { length: 64 }),
  privacyPolicyVersion: varchar("privacy_policy_version", { length: 16 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InsertConsentRecord = typeof consentRecords.$inferInsert;

// Ingredients — admin-managed list of available bar ingredients
export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(), // spirits, mixers, liqueurs, garnishes, syrups, juices, bitters
  available: boolean("available").default(true).notNull(),
  isCustom: boolean("is_custom").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Reads filter on availability and order by category.
  availableIdx: index("ingredients_available_idx").on(t.available),
  categoryIdx: index("ingredients_category_idx").on(t.category),
}));

export type Ingredient = typeof ingredients.$inferSelect;
export type InsertIngredient = typeof ingredients.$inferInsert;

// Admin settings — webhook URL and other config. No surrogate id column on
// the real table; `key` is the natural primary key.
export const adminSettings = pgTable("admin_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AdminSetting = typeof adminSettings.$inferSelect;

// Reviews — real seeded reviews shown on the landing page
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  name: varchar("reviewer_name", { length: 64 }).notNull(),
  text: text("review_text").notNull(),
  rating: integer("rating").notNull().default(5),
  avatarUrl: text("avatar_url"),
  isFemale: boolean("is_female"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Review = typeof reviews.$inferSelect;
