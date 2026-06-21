import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Quiz sessions — stores all answers and generated recipes
export const quizSessions = mysqlTable("quiz_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: varchar("sessionId", { length: 64 }).notNull().unique(),
  guestName: varchar("guestName", { length: 128 }),
  answers: json("answers").notNull(), // Array of {questionId, question, answer}
  flavorProfile: json("flavorProfile"), // Derived flavor profile object
  recipes: json("recipes"), // Array of 3 generated cocktail recipes
  selectedRecipeIndex: int("selectedRecipeIndex").default(0),
  // Order inquiry fields
  orderEmail: varchar("orderEmail", { length: 320 }),
  orderPhone: varchar("orderPhone", { length: 64 }),
  orderSubmitted: boolean("orderSubmitted").default(false).notNull(),
  webhookSent: boolean("webhookSent").default(false).notNull(),
  completed: boolean("completed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type QuizSession = typeof quizSessions.$inferSelect;
export type InsertQuizSession = typeof quizSessions.$inferInsert;

// Ingredients — admin-managed list of available bar ingredients
export const ingredients = mysqlTable("ingredients", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(), // spirits, mixers, liqueurs, garnishes, syrups, juices, bitters
  available: boolean("available").default(true).notNull(),
  isCustom: boolean("isCustom").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Ingredient = typeof ingredients.$inferSelect;
export type InsertIngredient = typeof ingredients.$inferInsert;

// Admin settings — webhook URL and other config
export const adminSettings = mysqlTable("admin_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdminSetting = typeof adminSettings.$inferSelect;

// Reviews — colorful UGC-style fake seed reviews shown on landing page
export const reviews = mysqlTable("reviews", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  text: text("text").notNull(),
  rating: int("rating").notNull().default(5),
  color: varchar("color", { length: 32 }).notNull().default("#ff6b35"),
  emoji: varchar("emoji", { length: 8 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Review = typeof reviews.$inferSelect;
