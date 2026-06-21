import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import LiquidSplash3D from "@/components/LiquidSplash3D";

const QUESTIONS = [
  {
    id: 1,
    emoji: "🌅",
    question: "It's a perfect evening. Where are you?",
    options: [
      { value: "rooftop_party", label: "Rooftop with a crowd, music pumping" },
      { value: "beach_sunset", label: "Beach at sunset, barefoot in the sand" },
      { value: "cozy_bar", label: "A cozy bar with close friends" },
      { value: "home_alone", label: "Home alone, fully unwinding" },
    ],
    splashColor: "#ff6b35",
    secondaryColor: "#f59e0b",
  },
  {
    id: 2,
    emoji: "🎭",
    question: "Pick the word that feels most like you right now.",
    options: [
      { value: "wild", label: "Wild" },
      { value: "chill", label: "Chill" },
      { value: "curious", label: "Curious" },
      { value: "romantic", label: "Romantic" },
    ],
    splashColor: "#a855f7",
    secondaryColor: "#ec4899",
  },
  {
    id: 3,
    emoji: "🍋",
    question: "You bite into a lemon. Your reaction is...",
    options: [
      { value: "love_it", label: "Love it. Bring more." },
      { value: "wince_enjoy", label: "I wince but secretly enjoy it" },
      { value: "need_sugar", label: "I need sugar with that" },
      { value: "absolutely_not", label: "Absolutely not, thanks" },
    ],
    splashColor: "#f59e0b",
    secondaryColor: "#10b981",
  },
  {
    id: 4,
    emoji: "🌶",
    question: "How do you feel about spicy food?",
    options: [
      { value: "obsessed", label: "Obsessed. The hotter the better." },
      { value: "enjoy_medium", label: "I enjoy a good kick" },
      { value: "mild_only", label: "Mild only, please" },
      { value: "no_spice", label: "I avoid spice entirely" },
    ],
    splashColor: "#ef4444",
    secondaryColor: "#f59e0b",
  },
  {
    id: 5,
    emoji: "🎵",
    question: "What music are you in the mood for tonight?",
    options: [
      { value: "deep_house", label: "Deep house or techno" },
      { value: "tropical_vibes", label: "Tropical, reggaeton, something sunny" },
      { value: "jazz_soul", label: "Jazz or soul, something smooth" },
      { value: "indie_chill", label: "Indie or chill lo-fi" },
    ],
    splashColor: "#22d3ee",
    secondaryColor: "#6366f1",
  },
  {
    id: 6,
    emoji: "🌿",
    question: "Pick your vibe from nature.",
    options: [
      { value: "tropical_jungle", label: "Tropical jungle, lush and wild" },
      { value: "ocean_breeze", label: "Ocean breeze, salty and free" },
      { value: "pine_forest", label: "Pine forest, earthy and grounding" },
      { value: "desert_night", label: "Desert at night, smoky and mysterious" },
    ],
    splashColor: "#10b981",
    secondaryColor: "#22d3ee",
  },
  {
    id: 7,
    emoji: "🍫",
    question: "Your ideal sweet treat is...",
    options: [
      { value: "dark_chocolate", label: "Dark chocolate, 85% or higher" },
      { value: "tropical_fruit", label: "Fresh tropical fruit" },
      { value: "salted_caramel", label: "Salted caramel anything" },
      { value: "creamy_vanilla", label: "Creamy vanilla or coconut" },
    ],
    splashColor: "#a855f7",
    secondaryColor: "#f59e0b",
  },
  {
    id: 8,
    emoji: "💫",
    question: "How adventurous are you feeling with your drink tonight?",
    options: [
      { value: "surprise_me", label: "Surprise me completely. I trust you." },
      { value: "adventurous_twist", label: "Something new but not too weird" },
      { value: "familiar_twist", label: "A classic with a twist" },
      { value: "keep_classic", label: "Keep it classic and familiar" },
    ],
    splashColor: "#ec4899",
    secondaryColor: "#a855f7",
  },
  {
    id: 9,
    emoji: "⚡",
    question: "What do you want from this drink?",
    options: [
      { value: "energy_up", label: "Energy up. I want to feel alive." },
      { value: "warm_glow", label: "A warm, happy glow" },
      { value: "deep_relax", label: "Deep relaxation" },
      { value: "social_spark", label: "Something to spark conversation" },
    ],
    splashColor: "#f59e0b",
    secondaryColor: "#ff6b35",
  },
  {
    id: 10,
    emoji: "🎨",
    question: "Pick a color that speaks to you right now.",
    options: [
      { value: "deep_purple", label: "Deep purple or midnight blue" },
      { value: "bright_orange", label: "Bright orange or coral" },
      { value: "electric_green", label: "Electric green or teal" },
      { value: "warm_gold", label: "Warm gold or amber" },
    ],
    splashColor: "#6366f1",
    secondaryColor: "#22d3ee",
  },
];

type QuizPhase = "name" | "questions" | "generating";

export default function Quiz() {
  const [, setLocation] = useLocation();
  const [phase, setPhase] = useState<QuizPhase>("name");
  const [guestName, setGuestName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [animState, setAnimState] = useState<"in" | "out" | "splash">("in");
  const [showSplash, setShowSplash] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");

  const startMutation = trpc.quiz.start.useMutation();
  const saveAnswerMutation = trpc.quiz.saveAnswer.useMutation();
  const generateMutation = trpc.quiz.generate.useMutation();

  const question = QUESTIONS[currentQ];
  const progress = ((currentQ) / QUESTIONS.length) * 100;

  const handleStartQuiz = async () => {
    if (!guestName.trim()) {
      setNameError("Tell us your name first!");
      return;
    }
    const result = await startMutation.mutateAsync({ guestName: guestName.trim() });
    setSessionId(result.sessionId);
    setPhase("questions");
    setAnimState("in");
  };

  const handleAnswer = async (value: string) => {
    if (!sessionId || selectedOption) return;
    setSelectedOption(value);

    // Save answer
    await saveAnswerMutation.mutateAsync({
      sessionId,
      questionId: question.id,
      question: question.question,
      answer: value,
    });

    setAnswers((prev) => ({ ...prev, [question.id]: value }));

    // Animate out, show splash, animate in
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
        // All questions answered, generate
        setPhase("generating");
        handleGenerate(sessionId);
      }
    }, 1000);
  };

  const handleGenerate = async (sid: string) => {
    try {
      const result = await generateMutation.mutateAsync({ sessionId: sid });
      setLocation(`/result/${result.sessionId}`);
    } catch (err) {
      console.error("Generation failed:", err);
      setLocation(`/result/${sid}`);
    }
  };

  if (phase === "name") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {["#ff6b35", "#a855f7", "#22d3ee"].map((c, i) => (
            <div key={i} className="absolute liquid-blob"
              style={{ width: 200 + i * 80, height: 200 + i * 80, background: c, opacity: 0.12,
                top: `${20 + i * 25}%`, left: i % 2 === 0 ? "-5%" : "75%", animationDelay: `${i * 2}s` }} />
          ))}
        </div>

        <div className="relative z-10 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4 float-anim">🍹</div>
            <h1 className="font-display text-4xl font-bold text-white mb-2">
              Let's find your cocktail
            </h1>
            <p className="text-white/60">First, what should we call you?</p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <input
              type="text"
              value={guestName}
              onChange={(e) => { setGuestName(e.target.value); setNameError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleStartQuiz()}
              placeholder="Your name..."
              className="w-full rounded-xl px-4 py-4 text-lg text-white placeholder-white/30 outline-none mb-4"
              style={{ background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)" }}
              autoFocus
            />
            {nameError && <p className="text-red-400 text-sm mb-3">{nameError}</p>}
            <button
              onClick={handleStartQuiz}
              disabled={startMutation.isPending}
              className="w-full rounded-xl py-4 text-lg font-bold text-black transition-all duration-200 active:scale-95 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}
            >
              {startMutation.isPending ? "Starting..." : "Start the Quiz →"}
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
            Mixing your cocktail...
          </h2>
          <p className="text-white/60 text-lg mb-8">Reading your flavor psychology and crafting 3 personalised recipes.</p>
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
          style={{ width: 300, height: 300, background: question.splashColor, opacity: 0.08, top: "10%", right: "-5%", transition: "background 0.5s" }} />
        <div className="absolute liquid-blob"
          style={{ width: 250, height: 250, background: question.secondaryColor, opacity: 0.08, bottom: "10%", left: "-5%", animationDelay: "3s", transition: "background 0.5s" }} />
      </div>

      {/* Progress bar */}
      <div className="relative z-10 px-4 pt-6 pb-2">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setLocation("/")} className="text-white/40 hover:text-white/70 text-sm transition-colors">
            ← Back
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
