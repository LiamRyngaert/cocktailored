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
  if (!db) throw new Error("DB not available");
  await db.insert(quizSessions).values(data);
}

export async function getQuizSession(sessionId: string) {
  const db = await getDb();
  if (!db) return undefined;
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
  if (!db) throw new Error("DB not available");
  await db.update(quizSessions).set(data).where(eq(quizSessions.sessionId, sessionId));
}

export async function getAllQuizSessions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(quizSessions).orderBy(desc(quizSessions.createdAt)).limit(200);
}

// ---- Ingredients ----
export async function getAllIngredients() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ingredients).orderBy(ingredients.category, ingredients.name);
}

export async function getAvailableIngredients() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(ingredients)
    .where(eq(ingredients.available, true))
    .orderBy(ingredients.category, ingredients.name);
}

export async function updateIngredientAvailability(id: number, available: boolean) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(ingredients).set({ available }).where(eq(ingredients.id, id));
}

export async function addCustomIngredient(data: InsertIngredient) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(ingredients).values({ ...data, isCustom: true });
}

export async function deleteIngredient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.isCustom, true)));
}

// ---- Admin Settings ----
export async function getAdminSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, key))
    .limit(1);
  return result.length > 0 ? (result[0].value ?? null) : null;
}

export async function setAdminSetting(key: string, value: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(adminSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function getAllAdminSettings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adminSettings);
}

// ---- Reviews ----
export async function getAllReviews() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reviews).orderBy(reviews.createdAt);
}
