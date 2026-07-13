import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { translateIngredientName } from "@shared/ingredientTranslations";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { RateLimiter, deliverWebhook, logInfo, runBackground, singleton } from "./_core/reliability";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  addCustomIngredient,
  createConsentRecord,
  createQuizSession,
  deleteIngredient,
  getAdminSetting,
  getAllAdminSettings,
  getAllIngredients,
  getAllQuizSessions,
  getAvailableIngredients,
  getQuizSession,
  getAllReviews,
  setAdminSetting,
  updateIngredientAvailability,
  updateQuizSession,
} from "./db";

const ADMIN_SESSION_KEY = "beast_admin_session";

// The single LeadConnector webhook the bar's automations listen on.
const WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/8nDL9BCU3hp9982tGYT1/webhook-trigger/71aa3d40-0ead-46d9-9255-2bbe7caa770d";

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

// ── Rate limiting (per client IP, per-instance token buckets) ─────────────────
// Protects expensive endpoints from abuse and accidental floods without
// blocking legitimate use. Limits are generous because a whole venue often
// shares one public IP (NAT) — a group taking the quiz together must never be
// throttled, while a runaway script still gets capped.
const generateLimiter = singleton("rl:generate", () => new RateLimiter(40, 1)); // burst 40, ~60/min sustained per IP
const scanLimiter = singleton("rl:scan", () => new RateLimiter(15, 0.3)); // admin-only, vision calls
const loginLimiter = singleton("rl:login", () => new RateLimiter(10, 0.1)); // strict brute-force guard
const orderLimiter = singleton("rl:order", () => new RateLimiter(40, 1));

function clientIp(ctx: { req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } } }): string {
  return (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? ctx.req.socket?.remoteAddress
    ?? "unknown";
}

function enforceRate(limiter: RateLimiter, key: string): void {
  const { ok, retryAfterMs } = limiter.take(key);
  if (!ok) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Te veel verzoeken. Probeer over ${Math.ceil(retryAfterMs / 1000)} seconden opnieuw.`,
    });
  }
}

function isAdminSession(ctx: { req: { headers: Record<string, string | string[] | undefined> } }): boolean {
  const cookie = (ctx.req.headers.cookie as string) ?? "";
  return cookie.includes(`${ADMIN_SESSION_KEY}=authenticated`);
}

// Every personalised cocktail is poured into the same glass, regardless of
// the recipe, so guests comparing drinks side by side see a consistent size.
const STANDARD_GLASS_ML = 180;

function rescaleToStandardVolume(
  ingredients: Array<{ name: string; amount: number; unit: string }>
): Array<{ name: string; amount: number; unit: string }> {
  if (ingredients.length === 0) return ingredients;
  const total = ingredients.reduce((sum, i) => sum + (i.amount || 0), 0);
  if (total <= 0) {
    const even = Math.round(STANDARD_GLASS_ML / ingredients.length);
    ingredients.forEach((i) => { i.amount = even; });
  } else {
    const scale = STANDARD_GLASS_ML / total;
    ingredients.forEach((i) => { i.amount = Math.max(1, Math.round(i.amount * scale)); });
  }
  // Rounding can leave the sum a couple of ml off target; put the drift on
  // the largest-volume ingredient where a 1-2ml shift is unnoticeable.
  const drift = STANDARD_GLASS_ML - ingredients.reduce((sum, i) => sum + i.amount, 0);
  if (drift !== 0) {
    const largest = ingredients.reduce((a, b) => (b.amount > a.amount ? b : a), ingredients[0]);
    largest.amount += drift;
  }
  return ingredients;
}

async function generateCocktailWithClaude(
  answers: Array<{ questionId: number; question: string; answer: string }>,
  availableIngredients: Array<{ name: string; category: string }>,
  allergies?: string[]
): Promise<{
  flavorProfile: Record<string, unknown>;
  recipes: Array<{
    name: string;
    tagline: string;
    ingredients: Array<{ name: string; amount: number; unit: string }>;
    instructions: string[];
    flavorNotes: string[];
    colorHex: string;
    spiritBase: string;
    profileExplanation: string;
  }>;
}> {
  const dutchIngredients = availableIngredients.map((i) => ({ ...i, name: translateIngredientName(i.name) }));
  const ingredientList = dutchIngredients.map((i) => `${i.name} (${i.category})`).join(", ");
  const answersText = answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");

  const systemPrompt = `You are a world-class cocktail psychologist and master mixologist. You use flavor psychology research to create deeply personalised cocktail recipes.

LANGUAGE: You MUST write ALL output in Dutch (Nederlands). This includes cocktail names, taglines, instructions, flavor notes, personality descriptions, profile explanations — absolutely everything. Use natural, fluent Dutch. Do not use English anywhere in your output.


FLAVOR PSYCHOLOGY PRINCIPLES you must apply:
1. Sweet preference links to agreeableness, warmth, and social openness. Sweet lovers enjoy approachable, fruity, crowd-pleasing cocktails.
2. Bitter preference links to openness to experience, complexity-seeking, and sophistication. Bitter lovers enjoy Negroni-style, amaro-forward, layered drinks.
3. Sour preference links to positive emotionality, assertiveness, and risk-taking. Sour lovers enjoy citrus-forward, bright, energetic cocktails.
4. Spicy/heat preference links to sensation-seeking, extraversion, and high testosterone. Spice lovers enjoy chili-infused, warming, bold cocktails.
5. Salty preference links to anxiety sensitivity and need for comfort. Salt lovers enjoy well-rounded, balanced, comforting cocktails.
6. Umami/savory preference links to intellectual curiosity and culinary adventurousness. Savory lovers enjoy unexpected, complex, chef-inspired cocktails.
7. Anxious personalities prefer familiar, sweeter, lower-ABV cocktails with comforting flavors.
8. Open/curious personalities prefer novel ingredients, unusual combinations, and complex flavor layering.
9. Extraverts prefer vibrant, colorful, shareable, visually striking cocktails.
10. Introverts prefer subtle, nuanced, contemplative cocktails with depth.
11. Mood-seeking behavior maps to spirit choice: rum/tequila for energy, whiskey/cognac for warmth and contemplation.
12. Social context maps to cocktail style: party drinks are fun and fruity, date drinks are elegant and sensual, solo drinks are complex and rewarding.
13. Time of day preference maps to strength and style: daytime means lighter and refreshing, evening means richer and stronger.
14. Adventure level maps to ingredient novelty: adventurous people get exotic ingredients, conservative people get classic combinations with a twist.
15. Color preference has psychological meaning: red/orange people are passionate and energetic, blue/green people are calm and creative, purple people are imaginative and spiritual.

CRITICAL RULES:
- ALL measurements MUST be in milliliters (ml) only. No ounces, no cups, no tablespoons.
- GLASS SIZE CONSISTENCY: every recipe's ingredient amounts must sum to exactly ${STANDARD_GLASS_ML}ml in total, so every personalised cocktail is always served in the same size glass no matter who it's for. Distribute that total across the ingredients however best fits the recipe's balance.
- ONLY use ingredients from the provided available ingredients list.
- Generate exactly 3 distinct cocktail variants that each express a different facet of the person's personality.
- Each recipe must be complete, buildable by a bartender, and genuinely delicious.
- Never use placeholder text or generic descriptions. Be specific and personal.
- Do not use em dashes (use commas or periods instead). Do not use the word "AI" or "algorithm" anywhere.
- Write as if you are a wise, warm bartender who truly knows this person.
- colorHex MUST be a medium to light color (never very dark). The UI has a black background, so dark colors like #1a0a00 or #0d0020 are invisible. Use vibrant, saturated mid-to-light tones. Brightness should be at least 40% in HSL.
- COLOR DIVERSITY IS CRITICAL: The colorHex of each cocktail must be genuinely derived from THIS person's specific quiz answers (their color preference in Q10, their personality, their mood, their flavor profile per principle 15). Do NOT default to orange/gold for everyone. Someone who chose green/teal should get a green cocktail, someone calm and creative gets blue/green, someone passionate gets red/orange, someone imaginative gets purple, someone fresh and bright gets yellow/lime, etc. Groups of friends will take this quiz together and compare results side by side. If everyone gets the same color, they will think the app is fake. The full rainbow is available: reds, oranges, yellows, greens, teals, blues, purples, pinks, magentas. Pick what truly fits the answers.
- The 3 cocktails for one person should also differ in color from each other, each reflecting a different facet of their personality, while all staying true to who they are.

AVAILABLE INGREDIENTS: ${ingredientList}${allergies && allergies.length > 0 && !allergies.includes("none") ? `\n\nALLERGY RESTRICTIONS — MUST AVOID: ${allergies.join(", ")}. Do NOT include any ingredient related to these restrictions in any of the 3 recipes.` : ""}`;

  const userPrompt = `Based on these quiz answers, create 3 personalised cocktail recipes for this person:

${answersText}

Return a JSON object with this exact structure:
{
  "flavorProfile": {
    "primaryFlavor": "sweet|sour|bitter|spicy|umami|salty",
    "secondaryFlavor": "sweet|sour|bitter|spicy|umami|salty",
    "personalityType": "one sentence describing their cocktail personality",
    "energyLevel": "low|medium|high",
    "adventureLevel": "classic|adventurous|wild",
    "socialStyle": "solo|intimate|social"
  },
  "recipes": [
    {
      "name": "Creative cocktail name",
      "tagline": "One punchy sentence that feels personal to them",
      "ingredients": [
        {"name": "exact ingredient name from available list", "amount": 45, "unit": "ml"},
        {"name": "another ingredient", "amount": 20, "unit": "ml"}
      ],
      "instructions": [
        "Step 1 instruction",
        "Step 2 instruction"
      ],
      "flavorNotes": ["flavor1", "flavor2", "flavor3"],
      "colorHex": "#hexcolor that represents this drink visually",
      "spiritBase": "the main spirit",
      "profileExplanation": "2-3 sentences explaining why this cocktail was made for them specifically, referencing their answers"
    }
  ]
}`;

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "cocktail_recipes",
        strict: true,
        schema: {
          type: "object",
          properties: {
            flavorProfile: {
              type: "object",
              properties: {
                primaryFlavor: { type: "string" },
                secondaryFlavor: { type: "string" },
                personalityType: { type: "string" },
                energyLevel: { type: "string" },
                adventureLevel: { type: "string" },
                socialStyle: { type: "string" },
              },
              required: ["primaryFlavor", "secondaryFlavor", "personalityType", "energyLevel", "adventureLevel", "socialStyle"],
              additionalProperties: false,
            },
            recipes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  tagline: { type: "string" },
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        amount: { type: "number" },
                        unit: { type: "string" },
                      },
                      required: ["name", "amount", "unit"],
                      additionalProperties: false,
                    },
                  },
                  instructions: { type: "array", items: { type: "string" } },
                  flavorNotes: { type: "array", items: { type: "string" } },
                  colorHex: { type: "string" },
                  spiritBase: { type: "string" },
                  profileExplanation: { type: "string" },
                },
                required: ["name", "tagline", "ingredients", "instructions", "flavorNotes", "colorHex", "spiritBase", "profileExplanation"],
                additionalProperties: false,
              },
            },
          },
          required: ["flavorProfile", "recipes"],
          additionalProperties: false,
        },
      },
    },
  });

  if (response.usage) {
    logInfo("llm", "cocktail generation token usage", {
      model: response.model,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    });
  }

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from Claude");
  let parsed: ReturnType<typeof JSON.parse>;
  if (typeof content === "string") {
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[Claude] Raw response (first 500 chars):", cleaned.slice(0, 500));
      throw new Error(`Claude returned invalid JSON: ${(e as Error).message}`);
    }
  } else {
    parsed = content;
  }

  // Enforce exactly 3 recipes
  if (!parsed.recipes || parsed.recipes.length < 1) {
    throw new Error("Claude returned no recipes");
  }
  while (parsed.recipes.length < 3) {
    parsed.recipes.push({ ...parsed.recipes[0], name: `${parsed.recipes[0].name} Twist ${parsed.recipes.length + 1}` });
  }
  parsed.recipes = parsed.recipes.slice(0, 3);

  // Enforce ml units and ingredient availability
  const availableNames = new Set(dutchIngredients.map((i) => i.name.toLowerCase()));
  for (const recipe of parsed.recipes) {
    for (const ing of recipe.ingredients) {
      ing.unit = "ml"; // always force ml
    }
    // Filter out ingredients not in available list (keep if name is close enough)
    recipe.ingredients = recipe.ingredients.filter((ing: { name: string; amount: number; unit: string }) => {
      const nameLower = ing.name.toLowerCase();
      return availableNames.has(nameLower) ||
        Array.from(availableNames).some((n) => n.includes(nameLower) || nameLower.includes(n));
    });
    // Ensure at least 2 ingredients remain
    if (recipe.ingredients.length < 2 && dutchIngredients.length >= 2) {
      recipe.ingredients = dutchIngredients.slice(0, 3).map((i) => ({ name: i.name, amount: 45, unit: "ml" }));
    }
    // Every personalised cocktail is the same glass size, whatever Claude returned.
    recipe.ingredients = rescaleToStandardVolume(recipe.ingredients);
  }

  return parsed;
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  admin: router({
    login: publicProcedure
      .input(z.object({ username: z.string(), password: z.string() }))
      .mutation(({ input, ctx }) => {
        enforceRate(loginLimiter, clientIp(ctx)); // throttle brute-force attempts
        if (input.username.trim() !== ENV.adminUsername.trim() || input.password !== ENV.adminPassword.trim()) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });
        }
        const proto = ctx.req.headers["x-forwarded-proto"] as string | undefined;
        const isHttps = ctx.req.protocol === "https" || (proto ? proto.split(",").some((p) => p.trim() === "https") : false) || ENV.isProduction;
        ctx.res.cookie(ADMIN_SESSION_KEY, "authenticated", {
          httpOnly: true,
          secure: isHttps,
          sameSite: "none",
          maxAge: 60 * 60 * 24 * 7,
          path: "/",
        });
        return { success: true };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(ADMIN_SESSION_KEY, { path: "/" });
      return { success: true };
    }),

    checkAuth: publicProcedure.query(({ ctx }) => {
      return { authenticated: isAdminSession(ctx) };
    }),

    getIngredients: publicProcedure.query(async ({ ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
      return getAllIngredients();
    }),

    updateIngredient: publicProcedure
      .input(z.object({ id: z.number(), available: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
        await updateIngredientAvailability(input.id, input.available);
        return { success: true };
      }),

    addIngredient: publicProcedure
      .input(z.object({ name: z.string().min(1), category: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
        await addCustomIngredient({ name: input.name, category: input.category, available: true, isCustom: true });
        return { success: true };
      }),

    deleteIngredient: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
        await deleteIngredient(input.id);
        return { success: true };
      }),

    getSettings: publicProcedure.query(async ({ ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
      return getAllAdminSettings();
    }),

    updateSetting: publicProcedure
      .input(z.object({ key: z.string(), value: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
        await setAdminSetting(input.key, input.value);
        return { success: true };
      }),

    getSessions: publicProcedure.query(async ({ ctx }) => {
      if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
      return getAllQuizSessions();
    }),

    /**
     * Photo ingredient scanner — accepts a base64-encoded image (JPEG/PNG/WebP),
     * passes it to Claude vision, and returns a list of identified bar ingredients.
     * Images are NEVER stored; only Claude's text output is returned.
     */
    scanIngredientPhoto: publicProcedure
      .input(z.object({
        imageBase64: z.string().min(10), // base64 data URI, e.g. "data:image/jpeg;base64,..."
      }))
      .mutation(async ({ input, ctx }) => {
        if (!isAdminSession(ctx)) throw new TRPCError({ code: "UNAUTHORIZED" });
        enforceRate(scanLimiter, clientIp(ctx));

        const response = await invokeLLM({
          model: "claude-haiku-4-5-20251001",
          messages: [
            {
              role: "system",
              content: `You are a professional bartender and ingredient identifier.
Your job is to look at photos of bar ingredients and identify exactly what they are.
Return a JSON object with a single key "ingredients" containing an array of identified ingredients.
Each item in the array must have:
- name: the specific ingredient name (e.g. "Hendricks Gin", "Fresh Mint", "Angostura Bitters", "Lime Juice")
- category: one of [spirits, liqueurs, mixers, juices, syrups, bitters, garnishes, other]
- confidence: "high", "medium", or "low"

Rules:
- Be specific. "Gin" is acceptable, but "Hendricks Gin" is better if you can tell.
- For fresh produce (mint, lime, lemon, etc.), use "garnishes" as category.
- If you see multiple ingredients in one photo, list all of them.
- If the image is unclear, still try your best and mark confidence as "low".
- Return ONLY the JSON object — no markdown, no extra text.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: input.imageBase64, detail: "high" },
                },
                {
                  type: "text",
                  text: "What bar ingredients do you see in this photo? Return only the JSON array.",
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "ingredient_scan",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        category: { type: "string", enum: ["spirits", "liqueurs", "mixers", "juices", "syrups", "bitters", "garnishes", "other"] },
                        confidence: { type: "string", enum: ["high", "medium", "low"] },
                      },
                      required: ["name", "category", "confidence"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["ingredients"],
                additionalProperties: false,
              },
            },
          },
        });

        const raw = response.choices[0]?.message?.content ?? "{}";
        let parsed: { ingredients: Array<{ name: string; category: string; confidence: string }> };
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not parse Claude response" });
        }

        return { ingredients: parsed.ingredients ?? [] };
      }),
  }),

  quiz: router({
    getConfig: publicProcedure.query(async () => {
      const value = await getAdminSetting("table_number_enabled");
      return { tableNumberEnabled: value === "true" };
    }),

    start: publicProcedure
      .input(z.object({ guestName: z.string().max(128).optional() }))
      .mutation(async ({ input }) => {
        const sessionId = nanoid(16);
        await createQuizSession({
          sessionId,
          guestName: input.guestName ? sanitizeText(input.guestName) : null,
          answers: [],
          webhookSent: false,
        });
        return { sessionId };
      }),

    saveAnswer: publicProcedure
      .input(z.object({
        sessionId: z.string(),
        questionId: z.number(),
        question: z.string(),
        answer: z.string(),
      }))
      .mutation(async ({ input }) => {
        const session = await getQuizSession(input.sessionId);
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

        const answers = (session.answers as Array<{ questionId: number; question: string; answer: string }>) ?? [];
        const existingIndex = answers.findIndex((a) => a.questionId === input.questionId);
        if (existingIndex >= 0) {
          answers[existingIndex] = { questionId: input.questionId, question: input.question, answer: input.answer };
        } else {
          answers.push({ questionId: input.questionId, question: input.question, answer: input.answer });
        }
        await updateQuizSession(input.sessionId, { answers });
        return { success: true };
      }),

    generate: publicProcedure
      .input(z.object({
        guestName: z.string().max(128).optional(),
        tableNumber: z.string().max(16).optional(),
        answers: z.array(z.object({
          questionId: z.number(),
          question: z.string(),
          answer: z.string(),
        })).min(1).max(20),
        allergies: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        enforceRate(generateLimiter, clientIp(ctx));
        const sessionId = nanoid(16);
        const guestName = input.guestName ? sanitizeText(input.guestName) : null;
        const tableNumber = input.tableNumber ? sanitizeText(input.tableNumber) : null;

        // Persist session with the real answers up front, so the order and
        // admin views never end up with an empty quiz even if generation fails.
        await createQuizSession({
          sessionId,
          guestName,
          tableNumber,
          answers: input.answers,
          webhookSent: false,
        });

        const availableIngredients = await getAvailableIngredients();
        const result = await generateCocktailWithClaude(input.answers, availableIngredients, input.allergies);

        // Persist the result (source of truth) before responding.
        await updateQuizSession(sessionId, {
          answers: input.answers,
          flavorProfile: result.flavorProfile,
          recipes: result.recipes,
          completedAt: new Date(),
          webhookSent: false,
        });

        // Notify the bar in the background so webhook latency never delays the
        // user's result. Delivery retries with backoff; on success we flip the
        // webhookSent flag.
        runBackground(async () => {
          const ok = await deliverWebhook(
            WEBHOOK_URL,
            {
              event: "cocktail_quiz_completed",
              sessionId,
              guestName: guestName ?? "Guest",
              tableNumber: tableNumber ?? undefined,
              timestamp: new Date().toISOString(),
              barName: "The Beast Bar",
              location: "Indonesia",
              flavorProfile: result.flavorProfile,
              recipes: result.recipes,
              quizAnswers: input.answers,
              whatsappNumber: "+32492532305",
            },
            { label: "quiz-webhook" }
          );
          if (ok) await updateQuizSession(sessionId, { webhookSent: true });
        });

        return { flavorProfile: result.flavorProfile, recipes: result.recipes, sessionId };
      }),

    getResult: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        const session = await getQuizSession(input.sessionId);
        if (!session || !session.completedAt) return null;
        return {
          flavorProfile: session.flavorProfile,
          recipes: session.recipes,
          guestName: session.guestName,
          sessionId: session.sessionId,
          orderSubmitted: session.orderSubmitted ?? false,
        };
      }),

    submitOrder: publicProcedure
      .input(z.object({
        sessionId: z.string().min(8).max(64),
        email: z.string().email().max(320),
        phone: z.string().min(6).max(32).optional(),
        selectedRecipeIndex: z.number().int().min(0).max(9).default(0),
        consentComms: z.boolean(),
        consentDataSharing: z.boolean(),
        consentFormVersion: z.string().max(16),
        // Fallback copies of the result the client is already holding. Used to
        // reconstruct the session if its stored row is missing (e.g. evicted),
        // so an order can never silently fail to reach the bar.
        guestName: z.string().max(128).optional(),
        recipes: z.array(z.unknown()).max(10).optional(),
        flavorProfile: z.unknown().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        enforceRate(orderLimiter, clientIp(ctx));
        const existing = await getQuizSession(input.sessionId);

        // Idempotent: a resubmit of an already-placed order is a no-op success.
        if (existing?.orderSubmitted) {
          return { success: true, alreadySubmitted: true };
        }

        // Prefer what the server already stored; fall back to the client's copy.
        const recipes = (existing?.recipes as Array<{ name: string; ingredients: Array<{ name: string; amount: number; unit: string }>; tagline: string; colorHex: string }> | null)
          ?? (input.recipes as Array<{ name: string; ingredients: Array<{ name: string; amount: number; unit: string }>; tagline: string; colorHex: string }> | undefined)
          ?? null;
        const guestName = existing?.guestName ?? (input.guestName ? sanitizeText(input.guestName) : null);
        const flavorProfile = existing?.flavorProfile ?? input.flavorProfile ?? null;
        const answers = existing?.answers ?? [];

        // If the stored session vanished, rebuild it from the client's data so
        // the order still lands in the admin instead of throwing NOT_FOUND.
        if (!existing) {
          if (!recipes || recipes.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
          }
          await createQuizSession({
            sessionId: input.sessionId,
            guestName,
            answers,
            flavorProfile,
            recipes,
            completedAt: new Date(),
            webhookSent: false,
          });
        }

        const consentIp = (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
          ?? ctx.req.socket?.remoteAddress
          ?? null;

        // Persist order details
        await updateQuizSession(input.sessionId, {
          orderEmail: input.email,
          orderPhone: input.phone,
          selectedRecipeIndex: input.selectedRecipeIndex,
          orderSubmitted: true,
          completedAt: new Date(),
        });

        // GDPR consent audit trail — a separate, immutable record rather than
        // columns on quiz_sessions.
        await createConsentRecord({
          sessionId: input.sessionId,
          email: input.email,
          consentMarketing: input.consentComms,
          consentThirdParty: input.consentDataSharing,
          privacyPolicyVersion: input.consentFormVersion,
          consentIp: consentIp ?? undefined,
          consentTimestamp: new Date(),
        });

        // Notify the bar in the background — the order is already persisted
        // (so it shows in the admin regardless), and delivery retries with
        // backoff without blocking the guest's confirmation.
        const whatsappNumber = await getAdminSetting("whatsapp_number");
        const selectedRecipe = recipes?.[input.selectedRecipeIndex] ?? recipes?.[0];
        runBackground(() =>
          deliverWebhook(
            WEBHOOK_URL,
            {
              event: "order_submitted",
              sessionId: input.sessionId,
              guestName,
              email: input.email,
              phone: input.phone,
              whatsappNumber,
              selectedRecipe,
              allRecipes: recipes,
              flavorProfile,
              quizAnswers: answers,
              submittedAt: new Date().toISOString(),
            },
            { label: "order-webhook" }
          )
        );

        return { success: true, alreadySubmitted: false };
      }),
  }),

  public: router({
    getReviews: publicProcedure.query(async () => {
      return getAllReviews();
    }),
  }),
});

export type AppRouter = typeof appRouter;
