import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertIngredient,
  InsertQuizSession,
  InsertUser,
  adminSettings,
  ingredients,
  quizSessions,
  reviews,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ---- In-memory fallback (used when DATABASE_URL is not configured) ----
const _memSessions = new Map<string, InsertQuizSession & { id: number; createdAt: Date; updatedAt: Date }>();
const _memSettings = new Map<string, string>();
let _memSessionCounter = 1;

const DEFAULT_INGREDIENTS: Array<{ id: number; name: string; category: string; available: boolean; isCustom: boolean; createdAt: Date }> = [
  { id: 1, name: "Vodka", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 2, name: "White Rum", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 3, name: "Dark Rum", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 4, name: "Gin", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 5, name: "Tequila", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 6, name: "Whiskey", category: "spirits", available: true, isCustom: false, createdAt: new Date() },
  { id: 7, name: "Triple Sec", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 8, name: "Kahlua", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 9, name: "Amaretto", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 10, name: "Coconut Rum", category: "liqueurs", available: true, isCustom: false, createdAt: new Date() },
  { id: 11, name: "Fresh Lime Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 12, name: "Fresh Lemon Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 13, name: "Orange Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 14, name: "Pineapple Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 15, name: "Cranberry Juice", category: "juices", available: true, isCustom: false, createdAt: new Date() },
  { id: 16, name: "Simple Syrup", category: "syrups", available: true, isCustom: false, createdAt: new Date() },
  { id: 17, name: "Grenadine", category: "syrups", available: true, isCustom: false, createdAt: new Date() },
  { id: 18, name: "Agave Syrup", category: "syrups", available: true, isCustom: false, createdAt: new Date() },
  { id: 19, name: "Soda Water", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 20, name: "Tonic Water", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 21, name: "Ginger Beer", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 22, name: "Cola", category: "mixers", available: true, isCustom: false, createdAt: new Date() },
  { id: 23, name: "Angostura Bitters", category: "bitters", available: true, isCustom: false, createdAt: new Date() },
  { id: 24, name: "Mint", category: "garnishes", available: true, isCustom: false, createdAt: new Date() },
  { id: 25, name: "Lime Wedge", category: "garnishes", available: true, isCustom: false, createdAt: new Date() },
];

// ---- Users ----
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ---- Quiz Sessions ----
export async function createQuizSession(data: InsertQuizSession) {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    _memSessions.set(data.sessionId, { ...data, id: _memSessionCounter++, createdAt: now, updatedAt: now });
    return;
  }
  await db.insert(quizSessions).values(data);
}

export async function getQuizSession(sessionId: string) {
  const db = await getDb();
  if (!db) return _memSessions.get(sessionId);
  const result = await db
    .select()
    .from(quizSessions)
    .where(eq(quizSessions.sessionId, sessionId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateQuizSession(
  sessionId: string,
  data: Partial<InsertQuizSession>
) {
  const db = await getDb();
  if (!db) {
    const existing = _memSessions.get(sessionId);
    if (existing) _memSessions.set(sessionId, { ...existing, ...data, updatedAt: new Date() });
    return;
  }
  await db.update(quizSessions).set(data).where(eq(quizSessions.sessionId, sessionId));
}

export async function getAllQuizSessions() {
  const db = await getDb();
  if (!db) return Array.from(_memSessions.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 200);
  return db.select().from(quizSessions).orderBy(desc(quizSessions.createdAt)).limit(200);
}

// ---- Ingredients ----
export async function getAllIngredients() {
  const db = await getDb();
  if (!db) return DEFAULT_INGREDIENTS;
  return db.select().from(ingredients).orderBy(ingredients.category, ingredients.name);
}

export async function getAvailableIngredients() {
  const db = await getDb();
  if (!db) return DEFAULT_INGREDIENTS.filter((i) => i.available);
  return db
    .select()
    .from(ingredients)
    .where(eq(ingredients.available, true))
    .orderBy(ingredients.category, ingredients.name);
}

export async function updateIngredientAvailability(id: number, available: boolean) {
  const db = await getDb();
  if (!db) {
    const ing = DEFAULT_INGREDIENTS.find((i) => i.id === id);
    if (ing) ing.available = available;
    return;
  }
  await db.update(ingredients).set({ available }).where(eq(ingredients.id, id));
}

export async function addCustomIngredient(data: InsertIngredient) {
  const db = await getDb();
  if (!db) {
    DEFAULT_INGREDIENTS.push({ ...data, id: DEFAULT_INGREDIENTS.length + 1, isCustom: true, createdAt: new Date() });
    return;
  }
  await db.insert(ingredients).values({ ...data, isCustom: true });
}

export async function deleteIngredient(id: number) {
  const db = await getDb();
  if (!db) {
    const idx = DEFAULT_INGREDIENTS.findIndex((i) => i.id === id && i.isCustom);
    if (idx >= 0) DEFAULT_INGREDIENTS.splice(idx, 1);
    return;
  }
  await db.delete(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.isCustom, true)));
}

// ---- Admin Settings ----
export async function getAdminSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return _memSettings.get(key) ?? null;
  const result = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, key))
    .limit(1);
  return result.length > 0 ? (result[0].value ?? null) : null;
}

export async function setAdminSetting(key: string, value: string) {
  const db = await getDb();
  if (!db) { _memSettings.set(key, value); return; }
  await db
    .insert(adminSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function getAllAdminSettings() {
  const db = await getDb();
  if (!db) return Array.from(_memSettings.entries()).map(([key, value], id) => ({ id, key, value, updatedAt: new Date() }));
  return db.select().from(adminSettings);
}

// ---- Reviews ----
export async function getAllReviews() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviews).orderBy(reviews.createdAt);
}
