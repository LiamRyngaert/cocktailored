import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

const CONSENT_FORM_VERSION = "v1";
import CocktailGlass3D from "@/components/CocktailGlass3D";
import LiquidSplash3D from "@/components/LiquidSplash3D";
import { toast } from "sonner";

type Recipe = {
  name: string;
  tagline: string;
  ingredients: Array<{ name: string; amount: number; unit: string }>;
  instructions: string[];
  flavorNotes: string[];
  colorHex: string;
  spiritBase: string;
  profileExplanation: string;
};

type FlavorProfile = {
  primaryFlavor: string;
  secondaryFlavor: string;
  personalityType: string;
  energyLevel: string;
  adventureLevel: string;
  socialStyle: string;
};

const FLAVOR_EMOJIS: Record<string, string> = {
  sweet: "🍓", sour: "🍋", bitter: "🍫", spicy: "🌶", umami: "🍄", salty: "🧂",
};

const ENERGY_LABELS: Record<string, string> = {
  low: "Ontspannen", medium: "Gebalanceerd", high: "Elektrisch",
};

const ADVENTURE_LABELS: Record<string, string> = {
  classic: "Klassieke Ziel", adventurous: "Avontuurlijk", wild: "Wild Card",
};

const SOCIAL_LABELS: Record<string, string> = {
  solo: "Solo Ontdekker", intimate: "Intieme Sfeer", social: "Sociale Vlinder",
};

const RANK_LABELS = ["#1 Perfecte match", "#2 Waarschijnlijk ook lekker", "#3 Prima keuze"];

function RecipeCard({ recipe, isActive, onClick, rank }: { recipe: Recipe; isActive: boolean; onClick: () => void; rank: number }) {
  const c = recipe.colorHex;
  return (
    <button
      onClick={onClick}
      className="rounded-md p-4 text-left transition-all duration-200 active:scale-98 w-full"
      style={{
        background: isActive ? `linear-gradient(135deg, ${c}30, ${c}10)` : "rgba(255,255,255,0.04)",
        border: isActive ? `2px solid ${c}` : "1.5px solid rgba(255,255,255,0.1)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${c}25`, color: c, border: `1px solid ${c}60` }}>
          {RANK_LABELS[rank] ?? RANK_LABELS[2]}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-1.5">
        <div className="w-7 h-7 rounded-full flex-shrink-0"
          style={{ background: c, boxShadow: `0 0 10px ${c}66` }} />
        <div>
          <div className="font-display text-base font-bold text-white leading-tight">{recipe.name}</div>
          <div className="text-white/40 text-xs">{recipe.spiritBase}</div>
        </div>
      </div>
      <p className="text-white/55 text-xs">{recipe.tagline}</p>
    </button>
  );
}

function OrderForm({ sessionId, selectedRecipeIndex, guestName, onSuccess }: {
  sessionId: string;
  selectedRecipeIndex: number;
  guestName?: string | null;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; age?: string; terms?: string }>({});

  const submitMutation = trpc.quiz.submitOrder.useMutation({
    onSuccess: () => {
      toast.success("Bestelling verzonden naar de bar!");
      onSuccess();
    },
    onError: () => {
      toast.error("Er is iets misgegaan. Probeer opnieuw.");
    },
  });

  const validate = () => {
    const e: { email?: string; age?: string; terms?: string } = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.email = "Voer een geldig e-mailadres in.";
    }
    if (!ageConfirmed) e.age = "Bevestig dat je 18 jaar of ouder bent.";
    if (!termsAccepted) e.terms = "Je moet de voorwaarden accepteren om verder te gaan.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    submitMutation.mutate({
      sessionId,
      email: email.trim(),
      selectedRecipeIndex,
      consentComms: ageConfirmed,
      consentDataSharing: termsAccepted,
      consentFormVersion: CONSENT_FORM_VERSION,
    });
  };

  return (
    <div className="rounded-md p-5"
      style={{ background: "rgba(255,107,53,0.08)", border: "2px solid rgba(255,107,53,0.35)" }}>
      {/* Clear intent header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-md flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
          🍹
        </div>
        <div>
          <div className="font-display text-lg font-bold text-white">Bestel deze cocktail</div>
          <p className="text-white/60 text-sm leading-snug mt-0.5">
            Door op de knop te drukken stuur je jouw cocktailverzoek rechtstreeks naar de barman.
            Je krijgt een <span className="text-white font-semibold">echt drankje</span> speciaal voor jou gemaakt.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-white/50 text-xs uppercase tracking-wider mb-1">
          {guestName ? `${guestName}'s e-mailadres` : "Jouw e-mailadres"}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErrors((prev) => ({ ...prev, email: undefined })); }}
          placeholder="you@example.com"
          className="w-full rounded-md px-3 py-3 text-white placeholder-white/25 outline-none text-sm"
          style={{ background: "rgba(255,255,255,0.07)", border: errors.email ? "1.5px solid #ef4444" : "1px solid rgba(255,255,255,0.12)" }}
        />
        {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => { setAgeConfirmed(e.target.checked); setErrors((prev) => ({ ...prev, age: undefined })); }}
            className="mt-0.5 w-4 h-4 accent-orange-400 flex-shrink-0"
          />
          <span className="text-white/70 text-sm">Ik ga akkoord met het ontvangen van communicatie van dit bedrijf.</span>
        </label>
        {errors.age && <p className="text-red-400 text-xs ml-7">{errors.age}</p>}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => { setTermsAccepted(e.target.checked); setErrors((prev) => ({ ...prev, terms: undefined })); }}
            className="mt-0.5 w-4 h-4 accent-orange-400 flex-shrink-0"
          />
          <span className="text-white/70 text-sm">Ik ga akkoord dat mijn gegevens gedeeld mogen worden met relevante externe partners voor marketingdoeleinden.</span>
        </label>
        {errors.terms && <p className="text-red-400 text-xs ml-7">{errors.terms}</p>}
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitMutation.isPending}
        className="w-full rounded-md py-4 text-base font-bold text-black transition-all duration-200 active:scale-95 disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)", boxShadow: "0 0 24px rgba(255,107,53,0.4)" }}
      >
        {submitMutation.isPending ? "Verzenden naar de bar..." : "Bestel Mijn Cocktail →"}
      </button>

      <p className="text-white/30 text-xs text-center mt-2.5">
        Jouw gegevens worden alleen gebruikt om jouw drankje te bereiden.{" "}
        <a href="/privacy" className="underline hover:text-white/50 transition-colors">Privacybeleid</a>
      </p>
    </div>
  );
}

function OrderConfirmation({ guestName }: { guestName?: string | null }) {
  return (
    <div className="rounded-md p-5 text-center"
      style={{ background: "rgba(16,185,129,0.1)", border: "2px solid rgba(16,185,129,0.35)" }}>
      <div className="text-4xl mb-3">🎉</div>
      <div className="font-display text-xl font-bold text-white mb-2">
        {guestName ? `${guestName}, je bestelling is geplaatst!` : "Je bestelling is geplaatst!"}
      </div>
      <p className="text-white/60 text-sm leading-relaxed">
        De barman heeft jouw verzoek ontvangen. Ga naar de bar en jouw gepersonaliseerde drankje staat klaar.
      </p>
    </div>
  );
}

export default function Result() {
  const params = useParams<{ sessionId: string }>();
  const [, setLocation] = useLocation();
  const [activeRecipe, setActiveRecipe] = useState(0);
  const [orderDone, setOrderDone] = useState(false);

  // Try localStorage first (set by Quiz page after generate)
  const cachedResult = (() => {
    try {
      const raw = localStorage.getItem(`quiz_result_${params.sessionId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const { data: serverData, isLoading, error } = trpc.quiz.getResult.useQuery(
    { sessionId: params.sessionId ?? "" },
    { enabled: !!params.sessionId && !cachedResult, retry: 3, retryDelay: 2000 }
  );

  const data = cachedResult ?? serverData;

  if (!cachedResult && isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0">
          <LiquidSplash3D color="#a855f7" secondaryColor="#22d3ee" height={window.innerHeight} />
        </div>
        <div className="relative z-10 text-center">
          <div className="text-7xl mb-6 float-anim">🍸</div>
          <h2 className="font-display text-3xl font-bold text-white mb-4">Jouw cocktails worden geladen...</h2>
          <div className="flex gap-2 justify-center">
            {["#ff6b35", "#a855f7", "#22d3ee"].map((c, i) => (
              <div key={i} className="w-3 h-3 rounded-full animate-bounce"
                style={{ background: c, animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!cachedResult && (error || !data)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <div className="text-6xl mb-4">😅</div>
        <h2 className="font-display text-3xl font-bold text-white mb-4">Er is iets misgegaan</h2>
        <p className="text-white/60 mb-6">We konden jouw resultaten niet laden. Probeer het opnieuw.</p>
        <button onClick={() => setLocation("/")}
          className="rounded-md px-6 py-3 font-bold text-black"
          style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
          Terug naar Home
        </button>
      </div>
    );
  }

  const recipes = data.recipes as Recipe[];
  const profile = data.flavorProfile as FlavorProfile;
  const recipe = recipes[activeRecipe];

  if (!recipe || !profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <div className="text-6xl mb-4">🔄</div>
        <h2 className="font-display text-3xl font-bold text-white mb-4">Recepten worden nog samengesteld...</h2>
        <p className="text-white/60 mb-6">Geef het even een moment en ververs de pagina.</p>
        <button onClick={() => window.location.reload()}
          className="rounded-md px-6 py-3 font-bold text-black"
          style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
          Vernieuwen
        </button>
      </div>
    );
  }

  const alreadyOrdered = orderDone || (data.orderSubmitted ?? false);

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div className="absolute liquid-blob"
          style={{ width: 500, height: 500, background: recipe.colorHex, opacity: 0.3, top: "5%", right: "-15%", transition: "background 0.8s" }} />
        <div className="absolute liquid-blob"
          style={{ width: 400, height: 400, background: "#a855f7", opacity: 0.25, bottom: "10%", left: "-10%", animationDelay: "3s" }} />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="px-4 pt-5 pb-2 flex items-center justify-between">
          <button onClick={() => setLocation("/")} className="text-white/40 hover:text-white/70 text-sm transition-colors">
            ← Home
          </button>
          <div className="text-white/40 text-xs">Jouw cocktailprofiel</div>
        </div>

        {/* Greeting */}
        <div className="px-4 pt-3 pb-2 text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white mb-1.5">
            {data.guestName ? `${data.guestName}, maak kennis met jouw cocktail.` : "Maak kennis met jouw cocktail."}
          </h1>
          <p className="text-white/55 text-sm">{profile.personalityType}</p>
        </div>

        {/* Flavor profile badges */}
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {[
              { label: `${FLAVOR_EMOJIS[profile.primaryFlavor] ?? "🍹"} ${profile.primaryFlavor}`, color: recipe.colorHex },
              { label: `${FLAVOR_EMOJIS[profile.secondaryFlavor] ?? "✨"} ${profile.secondaryFlavor}`, color: "#a855f7" },
              { label: ENERGY_LABELS[profile.energyLevel] ?? profile.energyLevel, color: "#22d3ee" },
              { label: ADVENTURE_LABELS[profile.adventureLevel] ?? profile.adventureLevel, color: "#f59e0b" },
              { label: SOCIAL_LABELS[profile.socialStyle] ?? profile.socialStyle, color: "#10b981" },
            ].map((badge, i) => (
              <span key={i} className="rounded px-2.5 py-1 text-xs font-bold capitalize"
                style={{ background: `${badge.color}20`, border: `1.5px solid ${badge.color}50`, color: badge.color }}>
                {badge.label}
              </span>
            ))}
          </div>
        </div>

        {/* 3D Cocktail Glass */}
        <div className="relative">
          <CocktailGlass3D
            color={recipe.colorHex}
            secondaryColor={recipes[(activeRecipe + 1) % recipes.length]?.colorHex ?? "#a855f7"}
            height={300}
          />
          <div className="absolute bottom-4 left-0 right-0 text-center">
            <div className="inline-block rounded-md px-4 py-2"
              style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)", border: `1.5px solid ${recipe.colorHex}44` }}>
              <div className="font-display text-xl font-bold text-white">{recipe.name}</div>
              <div className="text-white/55 text-xs">{recipe.tagline}</div>
            </div>
          </div>
        </div>

        {/* Recipe selector */}
        <div className="px-4 py-4">
          <p className="text-white/40 text-xs text-center mb-3 uppercase tracking-wider">3 cocktails gemaakt voor jou. Kies je favoriet.</p>
          <div className="grid grid-cols-1 gap-2">
            {recipes.map((r, i) => (
              <RecipeCard key={i} recipe={r} isActive={i === activeRecipe} onClick={() => setActiveRecipe(i)} rank={i} />
            ))}
          </div>
        </div>

        {/* Active recipe detail */}
        <div className="px-4 py-2">
          <div className="rounded-md p-5"
            style={{ background: `linear-gradient(135deg, ${recipe.colorHex}12, rgba(255,255,255,0.03))`, border: `1.5px solid ${recipe.colorHex}28` }}>

            {/* Profile explanation */}
            <div className="mb-5 p-3.5 rounded-md" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="text-white/40 text-xs uppercase tracking-wider mb-1.5">Waarom deze cocktail voor jou is</div>
              <p className="text-white/75 text-sm leading-relaxed">{recipe.profileExplanation}</p>
            </div>

            {/* Flavor notes */}
            <div className="mb-5">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Smaaknotities</div>
              <div className="flex flex-wrap gap-1.5">
                {recipe.flavorNotes.map((note, i) => (
                  <span key={i} className="rounded px-2.5 py-1 text-xs font-semibold text-white capitalize"
                    style={{ background: `${recipe.colorHex}28`, border: `1px solid ${recipe.colorHex}45` }}>
                    {note}
                  </span>
                ))}
              </div>
            </div>

            {/* Ingredients */}
            <div className="mb-5">
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2.5">Ingrediënten</div>
              <div className="grid grid-cols-1 gap-1.5">
                {recipe.ingredients.map((ing, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md px-3.5 py-2.5"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="text-white/80 text-sm">{ing.name}</span>
                    <span className="font-bold text-sm" style={{ color: recipe.colorHex }}>
                      {ing.amount} {ing.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Instructions */}
            <div>
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2.5">Hoe maak je het</div>
              <div className="flex flex-col gap-2">
                {recipe.instructions.map((step, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold text-black mt-0.5"
                      style={{ background: recipe.colorHex }}>
                      {i + 1}
                    </div>
                    <p className="text-white/65 text-sm leading-relaxed">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Order section */}
        <div className="px-4 py-4 pb-8">
          {alreadyOrdered ? (
            <OrderConfirmation guestName={data.guestName} />
          ) : (
            <OrderForm
              sessionId={params.sessionId ?? ""}
              selectedRecipeIndex={activeRecipe}
              guestName={data.guestName}
              onSuccess={() => setOrderDone(true)}
            />
          )}

          <div className="text-center mt-5">
            <button onClick={() => setLocation("/")}
              className="text-white/30 hover:text-white/60 text-sm transition-colors underline underline-offset-2">
              Opnieuw beginnen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
