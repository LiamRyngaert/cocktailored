import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import LiquidSplash3D from "@/components/LiquidSplash3D";

const QUESTIONS = [
  {
    id: 1,
    emoji: "🌅",
    question: "Het is een perfecte avond. Waar ben je?",
    options: [
      { value: "rooftop_party", label: "Op het dak met een menigte, muziek staat aan" },
      { value: "beach_sunset", label: "Op het strand bij zonsondergang, blootsvoets in het zand" },
      { value: "cozy_bar", label: "In een gezellige bar met goede vrienden" },
      { value: "home_alone", label: "Thuis alleen, volledig ontspannen" },
    ],
    splashColor: "#ff6b35",
    secondaryColor: "#f59e0b",
  },
  {
    id: 2,
    emoji: "🎭",
    question: "Kies het woord dat het meest bij jou past op dit moment.",
    options: [
      { value: "wild", label: "Wild" },
      { value: "chill", label: "Chill" },
      { value: "curious", label: "Nieuwsgierig" },
      { value: "romantic", label: "Romantisch" },
    ],
    splashColor: "#a855f7",
    secondaryColor: "#ec4899",
  },
  {
    id: 3,
    emoji: "🍋",
    question: "Je bijt in een citroen. Jouw reactie is...",
    options: [
      { value: "love_it", label: "Heerlijk. Geef meer." },
      { value: "wince_enjoy", label: "Ik trek een vies gezicht maar geniet er stiekem van" },
      { value: "need_sugar", label: "Ik heb er suiker bij nodig" },
      { value: "absolutely_not", label: "Absoluut niet, bedankt" },
    ],
    splashColor: "#f59e0b",
    secondaryColor: "#10b981",
  },
  {
    id: 4,
    emoji: "🌶",
    question: "Hoe sta jij tegenover pittig eten?",
    options: [
      { value: "obsessed", label: "Obsessief. Hoe heter, hoe beter." },
      { value: "enjoy_medium", label: "Ik geniet van een flinke kick" },
      { value: "mild_only", label: "Lekker mild graag" },
      { value: "no_spice", label: "Ik vermijd pittig volledig" },
    ],
    splashColor: "#ef4444",
    secondaryColor: "#f59e0b",
  },
  {
    id: 5,
    emoji: "🎵",
    question: "Waar heb je vanavond zin in qua muziek?",
    options: [
      { value: "deep_house", label: "Deep house of techno" },
      { value: "tropical_vibes", label: "Tropisch, reggaeton, iets zonnigs" },
      { value: "jazz_soul", label: "Jazz of soul, iets smooth" },
      { value: "indie_chill", label: "Indie of chill lo-fi" },
    ],
    splashColor: "#22d3ee",
    secondaryColor: "#6366f1",
  },
  {
    id: 6,
    emoji: "🌿",
    question: "Kies jouw vibe uit de natuur.",
    options: [
      { value: "tropical_jungle", label: "Tropische jungle, weelderig en wild" },
      { value: "ocean_breeze", label: "Oceaanbriesje, zout en vrij" },
      { value: "pine_forest", label: "Dennenbos, aards en rustgevend" },
      { value: "desert_night", label: "Woestijn 's nachts, rokerig en mysterieus" },
    ],
    splashColor: "#10b981",
    secondaryColor: "#22d3ee",
  },
  {
    id: 7,
    emoji: "🍫",
    question: "Jouw ideale zoete verwennerij is...",
    options: [
      { value: "dark_chocolate", label: "Pure chocolade, 85% of meer" },
      { value: "tropical_fruit", label: "Vers tropisch fruit" },
      { value: "salted_caramel", label: "Gezouten karamel in elke vorm" },
      { value: "creamy_vanilla", label: "Romige vanille of kokos" },
    ],
    splashColor: "#a855f7",
    secondaryColor: "#f59e0b",
  },
  {
    id: 8,
    emoji: "💫",
    question: "Hoe avontuurlijk voel jij je vanavond met je drankje?",
    options: [
      { value: "surprise_me", label: "Verras me volledig. Ik vertrouw je." },
      { value: "adventurous_twist", label: "Iets nieuws maar niet te vreemd" },
      { value: "familiar_twist", label: "Een klassieker met een twist" },
      { value: "keep_classic", label: "Houd het klassiek en vertrouwd" },
    ],
    splashColor: "#ec4899",
    secondaryColor: "#a855f7",
  },
  {
    id: 9,
    emoji: "⚡",
    question: "Wat wil je van dit drankje?",
    options: [
      { value: "energy_up", label: "Energie omhoog. Ik wil me levendig voelen." },
      { value: "warm_glow", label: "Een warm, blij gevoel" },
      { value: "deep_relax", label: "Diepe ontspanning" },
      { value: "social_spark", label: "Iets om een gesprek op gang te brengen" },
    ],
    splashColor: "#f59e0b",
    secondaryColor: "#ff6b35",
  },
  {
    id: 10,
    emoji: "🎨",
    question: "Kies een kleur die nu bij jou past.",
    options: [
      { value: "deep_purple", label: "Diep paars of middernachtblauw" },
      { value: "bright_orange", label: "Helder oranje of koraal" },
      { value: "electric_green", label: "Elektrisch groen of teal" },
      { value: "warm_gold", label: "Warm goud of amber" },
    ],
    splashColor: "#6366f1",
    secondaryColor: "#22d3ee",
  },
];

type QuizPhase = "name" | "questions" | "allergies" | "generating";

const ALLERGY_OPTIONS = [
  { value: "none", label: "Geen — Ik verdraag alles", emoji: "✓" },
  { value: "nuts", label: "Noten", emoji: "🥜" },
  { value: "dairy", label: "Zuivel / Room", emoji: "🧊" },
  { value: "gluten", label: "Gluten", emoji: "🌾" },
  { value: "citrus", label: "Citrus", emoji: "🍋" },
  { value: "eggs", label: "Eieren", emoji: "🥚" },
  { value: "shellfish", label: "Schaaldieren", emoji: "🦐" },
];

export default function Quiz() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<QuizPhase>("name");
  const [guestName, setGuestName] = useState("");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [animState, setAnimState] = useState<"in" | "out" | "splash">("in");
  const [showSplash, setShowSplash] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");
  const [selectedAllergies, setSelectedAllergies] = useState<string[]>(["none"]);
  const [allergyOther, setAllergyOther] = useState("");
  const [allergyError, setAllergyError] = useState("");

  const generateMutation = trpc.quiz.generate.useMutation();

  const question = QUESTIONS[currentQ];
  const progress = ((currentQ) / QUESTIONS.length) * 100;

  const handleStartQuiz = () => {
    if (!guestName.trim()) {
      setNameError("Vertel ons eerst je naam!");
      return;
    }
    setPhase("questions");
    setAnimState("in");
  };

  const handleAnswer = (value: string) => {
    if (selectedOption) return;
    setSelectedOption(value);

    const newAnswers = { ...answers, [question.id]: value };
    setAnswers(newAnswers);

    setAnimState("out");
    setTimeout(() => {
      setShowSplash(true);
      setAnimState("splash");
    }, 300);

    setTimeout(() => {
      setShowSplash(false);
      if (currentQ < QUESTIONS.length - 1) {
        setCurrentQ((q) => q + 1);
        setSelectedOption(null);
        setAnimState("in");
      } else {
        setPhase("allergies");
      }
    }, 1000);
  };

  const toggleAllergy = (value: string) => {
    if (value === "none") {
      setSelectedAllergies(["none"]);
    } else {
      setSelectedAllergies((prev) => {
        const without = prev.filter((v) => v !== "none");
        return without.includes(value) ? without.filter((v) => v !== value) : [...without, value];
      });
    }
    setAllergyError("");
  };

  const handleAllergySubmit = (collectedAnswers: Record<number, string>) => {
    if (selectedAllergies.length === 0) {
      setAllergyError("Selecteer minstens één optie hierboven.");
      return;
    }
    setPhase("generating");
    handleGenerate(collectedAnswers);
  };

  const handleGenerate = async (collectedAnswers: Record<number, string>) => {
    const answersArray = QUESTIONS.map((q) => ({
      questionId: q.id,
      question: q.question,
      answer: collectedAnswers[q.id] ?? "",
    })).filter((a) => a.answer);

    const allergiesPayload = selectedAllergies.includes("none")
      ? []
      : [...selectedAllergies, ...(allergyOther.trim() ? [allergyOther.trim()] : [])];

    try {
      const result = await generateMutation.mutateAsync({
        guestName: guestName.trim() || undefined,
        answers: answersArray,
        allergies: allergiesPayload.length > 0 ? allergiesPayload : undefined,
      });
      // Store result in localStorage so the result page can access it immediately
      localStorage.setItem(`quiz_result_${result.sessionId}`, JSON.stringify(result));
      setLocation(`/result/${result.sessionId}`);
    } catch (err) {
      console.error("Generation failed:", err);
    }
  };

  if (phase === "name") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {["#ff6b35", "#a855f7", "#22d3ee"].map((c, i) => (
            <div key={i} className="absolute liquid-blob"
              style={{ width: 280 + i * 100, height: 280 + i * 100, background: c, opacity: 0.45,
                top: `${20 + i * 25}%`, left: i % 2 === 0 ? "-5%" : "75%", animationDelay: `${i * 2}s` }} />
          ))}
        </div>

        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4 float-anim">🍹</div>
            <h1 className="font-display text-4xl font-bold text-white mb-2">
              Laten we jouw cocktail vinden
            </h1>
            <p className="text-white/60">Eerst, hoe mogen we je noemen?</p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <input
              type="text"
              value={guestName}
              onChange={(e) => { setGuestName(e.target.value); setNameError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleStartQuiz()}
              placeholder="Jouw naam..."
              className="w-full rounded-xl px-4 py-4 text-lg text-white placeholder-white/30 outline-none mb-4"
              style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)" }}
              autoFocus
            />
            {nameError && <p className="text-red-400 text-sm mb-3">{nameError}</p>}
            <button
              onClick={handleStartQuiz}
              className="w-full rounded-xl py-4 text-lg font-bold text-black transition-all duration-200 active:scale-95"
              style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}
            >
              Start de Quiz →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "allergies") {
    return (
      <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {["#10b981", "#22d3ee", "#a855f7"].map((c, i) => (
            <div key={i} className="absolute liquid-blob"
              style={{ width: 280 + i * 100, height: 280 + i * 100, background: c, opacity: 0.35,
                top: `${20 + i * 25}%`, left: i % 2 === 0 ? "-5%" : "75%", animationDelay: `${i * 2}s` }} />
          ))}
        </div>

        {/* Progress bar */}
        <div className="relative z-10 px-4 pt-6 pb-2">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setPhase("questions")} className="text-white/40 hover:text-white/70 text-sm transition-colors">
              ← Terug
            </button>
            <span className="text-sm font-semibold px-3 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.2)", color: "#10b981" }}>
              Bijna klaar!
            </span>
          </div>
          <div className="w-full h-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full" style={{ width: "100%", background: "linear-gradient(90deg, #10b981, #22d3ee)" }} />
          </div>
        </div>

        <div className="relative z-10 flex-1 flex flex-col items-center px-4 py-6 overflow-y-auto">
          <div style={{ width: "100%", maxWidth: "480px" }}>
            {/* Header */}
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">🌿</div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight mb-2">
                Allergieën of ingrediënten te vermijden?
              </h2>
              <p className="text-white/50 text-sm">We zorgen ervoor dat geen van deze in jouw recepten verschijnt.</p>
            </div>

            {/* Options — single column like cocktailored.ai */}
            <div className="flex flex-col gap-2 mb-4">
              {ALLERGY_OPTIONS.map((opt) => {
                const isSelected = selectedAllergies.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleAllergy(opt.value)}
                    className="w-full rounded-2xl px-4 py-3.5 text-left font-semibold text-white transition-all duration-150 active:scale-98 flex items-center gap-3"
                    style={{
                      background: isSelected ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.06)",
                      border: isSelected ? "2px solid #10b981" : "1.5px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    {/* Icon on the LEFT — emoji for food items, ✓ for "none" */}
                    <div
                      className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 text-lg transition-all duration-150"
                      style={{
                        background: isSelected ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.08)",
                      }}
                    >
                      <span>{opt.emoji}</span>
                    </div>
                    {/* Label */}
                    <span className="text-sm flex-1">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Free-text other */}
            <input
              type="text"
              value={allergyOther}
              onChange={(e) => setAllergyOther(e.target.value)}
              placeholder="Andere allergie of ingrediënt te vermijden..."
              className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none mb-1"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
            />

            {allergyError && <p className="text-red-400 text-xs mt-1 mb-2">{allergyError}</p>}
            {!allergyError && <p className="text-white/30 text-xs mt-1 mb-4">Selecteer minstens één optie hierboven</p>}

            <button
              onClick={() => handleAllergySubmit(answers)}
              className="w-full rounded-xl py-4 text-lg font-bold text-white transition-all duration-200 active:scale-95 mt-2"
              style={{ background: "linear-gradient(135deg, #0d9488, #10b981)", boxShadow: "0 0 32px rgba(16,185,129,0.4)" }}
            >
              Brew Mijn Cocktails →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "generating") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0">
          <LiquidSplash3D color="#ff6b35" secondaryColor="#a855f7" height={window.innerHeight} particleCount={120} />
        </div>
        <div className="relative z-10 text-center">
          <div className="text-7xl mb-6 float-anim">🧪</div>
          <h2 className="font-display text-4xl font-bold text-white mb-4">
            Jouw cocktail wordt gemixt...
          </h2>
          <p className="text-white/60 text-lg mb-8">Jouw smaakpsychologie wordt gelezen en 3 gepersonaliseerde recepten worden samengesteld.</p>
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

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Splash overlay */}
      {showSplash && (
        <div className="absolute inset-0 z-50 pointer-events-none">
          <LiquidSplash3D
            color={question.splashColor}
            secondaryColor={question.secondaryColor}
            height={window.innerHeight}
            particleCount={150}
          />
        </div>
      )}

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute liquid-blob"
          style={{ width: 400, height: 400, background: question.splashColor, opacity: 0.35, top: "5%", right: "-10%", transition: "background 0.5s" }} />
        <div className="absolute liquid-blob"
          style={{ width: 350, height: 350, background: question.secondaryColor, opacity: 0.3, bottom: "5%", left: "-10%", animationDelay: "3s", transition: "background 0.5s" }} />
      </div>

      {/* Progress bar */}
      <div className="relative z-10 px-4 pt-6 pb-2">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setLocation("/")} className="text-white/40 hover:text-white/70 text-sm transition-colors">
            ← Terug
          </button>
          <span className="text-white/40 text-sm">{currentQ + 1} / {QUESTIONS.length}</span>
        </div>
        <div className="w-full h-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${question.splashColor}, ${question.secondaryColor})` }} />
        </div>
      </div>

      {/* Question */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div
          key={currentQ}
          className={animState === "in" ? "splash-in" : animState === "out" ? "splash-out" : ""}
          style={{ width: "100%", maxWidth: "480px" }}
        >
          {/* Question card */}
          <div className="rounded-3xl p-6 sm:p-8 mb-6"
            style={{ background: "rgba(255,255,255,0.05)", border: `1.5px solid ${question.splashColor}33` }}>
            <div className="text-5xl mb-4 text-center">{question.emoji}</div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white text-center leading-tight">
              {question.question}
            </h2>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 gap-3">
            {question.options.map((option) => {
              const isSelected = selectedOption === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleAnswer(option.value)}
                  disabled={!!selectedOption}
                  className="w-full rounded-2xl px-5 py-4 text-left font-semibold text-white transition-all duration-200 active:scale-97 disabled:cursor-default"
                  style={{
                    background: isSelected
                      ? `linear-gradient(135deg, ${question.splashColor}44, ${question.secondaryColor}44)`
                      : "rgba(255,255,255,0.06)",
                    border: isSelected
                      ? `2px solid ${question.splashColor}`
                      : "1.5px solid rgba(255,255,255,0.12)",
                    transform: isSelected ? "scale(1.02)" : "scale(1)",
                  }}
                >
                  <span className="text-base">{option.label}</span>
                  {isSelected && <span className="float-right text-lg">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
