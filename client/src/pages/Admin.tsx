import { useState, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type AdminTab = "ingredients" | "sessions" | "settings";

const CATEGORIES = ["spirits", "liqueurs", "mixers", "juices", "syrups", "bitters", "garnishes", "other"];

const CATEGORY_LABELS: Record<string, string> = {
  spirits: "Spirits", liqueurs: "Liqueurs", mixers: "Mixers", juices: "Juices",
  syrups: "Syrups", bitters: "Bitters", garnishes: "Garnishes", other: "Other",
};

const CATEGORY_COLORS: Record<string, string> = {
  spirits: "#ff6b35", liqueurs: "#a855f7", mixers: "#22d3ee", juices: "#f59e0b",
  syrups: "#ec4899", bitters: "#10b981", garnishes: "#6366f1", other: "#94a3b8",
};

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const loginMutation = trpc.admin.login.useMutation();

  const handleLogin = async () => {
    if (!username || !password) { setError("Fill in both fields."); return; }
    try {
      await loginMutation.mutateAsync({ username, password });
      onLogin();
    } catch {
      setError("Wrong credentials. Try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute liquid-blob" style={{ width: 320, height: 320, background: "#ff6b35", opacity: 0.08, top: "5%", left: "-8%" }} />
      <div className="absolute liquid-blob" style={{ width: 260, height: 260, background: "#a855f7", opacity: 0.08, bottom: "8%", right: "-6%", animationDelay: "3s" }} />

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg mb-4"
            style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
            <span className="text-3xl">🍹</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-white">Beast Bar Admin</h1>
          <p className="text-white/40 text-sm mt-1">Manage your bar</p>
        </div>
        <div className="rounded-lg p-6" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <label className="block text-white/60 text-xs uppercase tracking-wider mb-1.5">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(""); }}
            placeholder="Username"
            className="w-full rounded-md px-4 py-3 text-white placeholder-white/30 outline-none mb-4"
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
          />
          <label className="block text-white/60 text-xs uppercase tracking-wider mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Password"
            className="w-full rounded-md px-4 py-3 text-white placeholder-white/30 outline-none mb-5"
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
          />
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loginMutation.isPending}
            className="w-full rounded-md py-3 font-bold text-black transition-all duration-200 active:scale-95 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}
          >
            {loginMutation.isPending ? "Logging in..." : "Log In"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IngredientToggle({ available, onChange }: { available: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative w-10 h-5 rounded-full transition-all duration-200 flex-shrink-0"
      style={{
        background: available ? "linear-gradient(135deg, #10b981, #22d3ee)" : "rgba(255,255,255,0.12)",
      }}
    >
      <div
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200"
        style={{ left: available ? "calc(100% - 1.125rem)" : "0.125rem" }}
      />
    </button>
  );
}

function PhotoScanner({ onAdd }: { onAdd: (name: string, category: string) => void }) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; category: string; confidence: string }> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);

  const scanMutation = trpc.admin.scanIngredientPhoto.useMutation({
    onSuccess: (data) => {
      if (!data.ingredients || data.ingredients.length === 0) {
        toast.error("No ingredients found in photo. Try a clearer shot.");
        setScanning(false);
        return;
      }
      setResults(data.ingredients);
      setSelected(new Set(data.ingredients.map((_, i) => i)));
      setScanning(false);
    },
    onError: (err) => {
      toast.error(err.message ?? "Could not identify ingredients. Try a clearer photo.");
      setScanning(false);
    },
  });

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Image too large. Max 10MB."); return; }
    setScanning(true);
    setResults(null);
    const reader = new FileReader();
    reader.onerror = () => { toast.error("Could not read file."); setScanning(false); };
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) { toast.error("Could not read file."); setScanning(false); return; }
      scanMutation.mutate({ imageBase64: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleAddSelected = async () => {
    if (!results) return;
    setAdding(true);
    const toAdd = results.filter((_, i) => selected.has(i));
    for (const ing of toAdd) {
      onAdd(ing.name, ing.category);
      await new Promise((r) => setTimeout(r, 80));
    }
    toast.success(`Added ${toAdd.length} ingredient${toAdd.length !== 1 ? "s" : ""} from photo!`);
    setResults(null);
    setSelected(new Set());
    setAdding(false);
  };

  const reset = () => { setResults(null); setSelected(new Set()); setScanning(false); };

  const CONFIDENCE_COLORS: Record<string, string> = { high: "#10b981", medium: "#f59e0b", low: "#ef4444" };

  return (
    <div className="mb-4">
      <div className="text-white/50 text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
        <span>📸</span> Scan ingredients by photo
      </div>

      {!results && !scanning && (
        <>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="transition-all duration-150"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1.5px dashed rgba(255,255,255,0.18)",
              borderRadius: "8px",
              padding: "20px",
              textAlign: "center",
            }}
          >
            <div className="text-3xl mb-3">📷</div>
            <div className="text-white/60 text-sm font-medium mb-4">Photograph a bottle or any bar ingredient</div>
            <div className="flex gap-2 justify-center">
              {/* Camera button — opens live camera on mobile */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold text-black text-sm transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}
              >
                📸 Camera
              </button>
              {/* Gallery / file picker */}
              <button
                onClick={() => galleryInputRef.current?.click()}
                className="flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold text-white/70 text-sm transition-all hover:text-white active:scale-95"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                🖼 Upload
              </button>
            </div>
            <div className="text-white/25 text-xs mt-3">Drag & drop also works</div>
          </div>
          {/* Camera input — triggers native camera (no gallery) */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          {/* Gallery input — opens file picker / photo library */}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
        </>
      )}

      {scanning && (
        <div className="text-center py-6" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: "8px" }}>
          <div className="text-3xl mb-2 animate-bounce">🔍</div>
          <div className="text-white/70 text-sm">Claude is identifying your ingredients...</div>
          <button onClick={reset} className="text-white/30 hover:text-white/50 text-xs mt-3 transition-colors">Cancel</button>
        </div>
      )}

      {results && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "14px" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-white text-sm font-semibold">Found {results.length} ingredient{results.length !== 1 ? "s" : ""}</div>
            <button onClick={reset} className="text-white/30 hover:text-white/60 text-xs transition-colors">Clear</button>
          </div>
          <div className="flex flex-col gap-1.5 mb-3">
            {results.map((ing, i) => (
              <button
                key={i}
                onClick={() => setSelected((prev) => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; })}
                className="flex items-center justify-between rounded-md px-3 py-2 text-left transition-all duration-100"
                style={{
                  background: selected.has(i) ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.03)",
                  border: selected.has(i) ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded flex items-center justify-center text-xs flex-shrink-0" style={{ background: selected.has(i) ? "#10b981" : "rgba(255,255,255,0.1)" }}>
                    {selected.has(i) ? "✓" : ""}
                  </div>
                  <span className="text-white text-sm">{ing.name}</span>
                  <span className="text-white/35 text-xs">{CATEGORY_LABELS[ing.category] ?? ing.category}</span>
                </div>
                <span className="text-xs font-semibold" style={{ color: CONFIDENCE_COLORS[ing.confidence] }}>
                  {ing.confidence}
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddSelected}
              disabled={selected.size === 0 || adding}
              className="flex-1 rounded-md py-2.5 font-bold text-black text-sm disabled:opacity-50 transition-all"
              style={{ background: "linear-gradient(135deg, #10b981, #22d3ee)" }}
            >
              {adding ? "Adding..." : `Add ${selected.size} selected`}
            </button>
            <button
              onClick={reset}
              className="rounded-md px-3 py-2.5 text-white/50 text-sm hover:text-white transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              New photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IngredientsTab() {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("spirits");
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: ingredients, refetch } = trpc.admin.getIngredients.useQuery();
  const updateMutation = trpc.admin.updateIngredient.useMutation({ onSuccess: () => refetch() });
  const addMutation = trpc.admin.addIngredient.useMutation({
    onSuccess: () => { refetch(); setNewName(""); setShowAddForm(false); toast.success("Ingredient added!"); },
  });
  const deleteMutation = trpc.admin.deleteIngredient.useMutation({
    onSuccess: () => { refetch(); toast.success("Ingredient removed."); },
  });

  const handlePhotoAdd = (name: string, category: string) => {
    addMutation.mutate({ name, category });
  };

  const filtered = useMemo(() => {
    return (ingredients ?? []).filter((i) => {
      const matchesCat = activeCat === "all" || i.category === activeCat;
      const matchesSearch = i.name.toLowerCase().includes(search.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [ingredients, activeCat, search]);

  const availableCount = (ingredients ?? []).filter((i) => i.available).length;
  const totalCount = (ingredients ?? []).length;

  // Group by category for the grid view
  const grouped = useMemo(() => {
    if (activeCat !== "all") return { [activeCat]: filtered };
    const groups: Record<string, typeof filtered> = {};
    for (const cat of CATEGORIES) {
      const items = filtered.filter((i) => i.category === cat);
      if (items.length > 0) groups[cat] = items;
    }
    const other = filtered.filter((i) => !CATEGORIES.includes(i.category));
    if (other.length > 0) groups["other"] = [...(groups["other"] ?? []), ...other];
    return groups;
  }, [filtered, activeCat]);

  return (
    <div className="flex flex-col gap-5">
      {/* Photo scanner */}
      <PhotoScanner onAdd={handlePhotoAdd} />

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md p-3 text-center" style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
          <div className="font-display text-2xl font-bold text-white">{availableCount}</div>
          <div className="text-white/50 text-xs">In stock</div>
        </div>
        <div className="rounded-md p-3 text-center" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <div className="font-display text-2xl font-bold text-white">{totalCount - availableCount}</div>
          <div className="text-white/50 text-xs">Out of stock</div>
        </div>
        <div className="rounded-md p-3 text-center" style={{ background: "rgba(255,107,53,0.12)", border: "1px solid rgba(255,107,53,0.25)" }}>
          <div className="font-display text-2xl font-bold text-white">{totalCount}</div>
          <div className="text-white/50 text-xs">Total</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ingredients..."
          className="w-full rounded-md pl-9 pr-4 py-2.5 text-white placeholder-white/30 outline-none text-sm"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 text-sm">
            ✕
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {["all", ...CATEGORIES].map((cat) => {
          const isActive = activeCat === cat;
          const color = cat === "all" ? "#ff6b35" : CATEGORY_COLORS[cat];
          return (
            <button key={cat} onClick={() => setActiveCat(cat)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150"
              style={{
                background: isActive ? `${color}25` : "rgba(255,255,255,0.05)",
                border: isActive ? `1.5px solid ${color}` : "1px solid rgba(255,255,255,0.08)",
                color: isActive ? color : "rgba(255,255,255,0.5)",
              }}>
              {cat === "all" ? `All (${totalCount})` : CATEGORY_LABELS[cat]}
            </button>
          );
        })}
      </div>

      {/* Ingredient grid grouped by category */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-8 text-white/30 text-sm">No ingredients match your search.</div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat] ?? "#94a3b8" }} />
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">
                {CATEGORY_LABELS[cat] ?? cat} ({items.length})
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {items.map((ing) => (
                <div key={ing.id}
                  className="flex items-center justify-between rounded-md px-3 py-2.5 group"
                  style={{
                    background: ing.available ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.03)",
                    border: ing.available ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <IngredientToggle
                      available={ing.available}
                      onChange={() => updateMutation.mutate({ id: ing.id, available: !ing.available })}
                    />
                    <span className={`text-sm truncate ${ing.available ? "text-white" : "text-white/40 line-through"}`}>
                      {ing.name}
                    </span>
                  </div>
                  {ing.isCustom && (
                    <button onClick={() => deleteMutation.mutate({ id: ing.id })}
                      className="text-red-400/40 hover:text-red-400 text-xs transition-colors ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100">
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Add custom ingredient */}
      <div className="border-t border-white/8 pt-4">
        {showAddForm ? (
          <div className="rounded-md p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-white font-semibold text-sm mb-3">Add custom ingredient</div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ingredient name..."
              className="w-full rounded-md px-3 py-2.5 text-white placeholder-white/30 outline-none mb-2 text-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
              autoFocus
            />
            <select
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="w-full rounded-md px-3 py-2.5 text-white outline-none mb-3 text-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              {CATEGORIES.map((c) => <option key={c} value={c} style={{ background: "#0d0d1a" }}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => addMutation.mutate({ name: newName, category: newCat })}
                disabled={!newName.trim() || addMutation.isPending}
                className="flex-1 rounded-md py-2.5 font-bold text-black text-sm disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
                {addMutation.isPending ? "Adding..." : "Add Ingredient"}
              </button>
              <button onClick={() => setShowAddForm(false)}
                className="rounded-md px-4 py-2.5 text-white/50 text-sm hover:text-white transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddForm(true)}
            className="w-full rounded-md py-2.5 font-semibold text-white/50 text-sm transition-all duration-150 hover:text-white hover:border-white/30"
            style={{ background: "rgba(255,255,255,0.03)", border: "1.5px dashed rgba(255,255,255,0.15)" }}>
            + Add custom ingredient
          </button>
        )}
      </div>
    </div>
  );
}

function SessionsTab() {
  const { data: sessions } = trpc.admin.getSessions.useQuery();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return (sessions ?? []).filter((s) =>
      (s.guestName ?? "").toLowerCase().includes(search.toLowerCase())
    );
  }, [sessions, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-white/50 text-sm">{(sessions ?? []).length} total sessions</span>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="rounded-md pl-7 pr-3 py-2 text-white placeholder-white/30 outline-none text-xs"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", width: "160px" }}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {filtered.map((session) => {
          const recipes = session.recipes as Array<{ name: string; colorHex: string }> | null;
          const answers = session.answers as Array<{ question: string; answer: string }> | null;
          const isExpanded = expandedId === session.id;

          return (
            <div key={session.id} className="rounded-md overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <button onClick={() => setExpandedId(isExpanded ? null : session.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left">
                <div>
                  <div className="text-white font-semibold text-sm">{session.guestName ?? "Anonymous"}</div>
                  <div className="text-white/40 text-xs">
                    {new Date(session.createdAt).toLocaleDateString()} at {new Date(session.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {session.completed && (
                    <span className="text-xs rounded px-2 py-0.5 font-semibold"
                      style={{ background: "rgba(16,185,129,0.2)", color: "#10b981" }}>
                      Done
                    </span>
                  )}
                  {session.webhookSent && (
                    <span className="text-xs rounded px-2 py-0.5 font-semibold"
                      style={{ background: "rgba(34,211,238,0.2)", color: "#22d3ee" }}>
                      Sent
                    </span>
                  )}
                  <span className="text-white/30 text-xs">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
                  {recipes && recipes.length > 0 && (
                    <div>
                      <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Generated cocktails</div>
                      <div className="flex flex-col gap-1">
                        {recipes.map((r, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: r.colorHex }} />
                            <span className="text-white/70 text-sm">{r.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {answers && answers.length > 0 && (
                    <div>
                      <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Quiz answers</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {answers.map((a, i) => (
                          <div key={i} className="rounded px-3 py-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <div className="text-white/40 text-xs leading-tight">{a.question}</div>
                            <div className="text-white/80 text-sm capitalize font-medium">{a.answer.replace(/_/g, " ")}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-white/30">
            <div className="text-4xl mb-3">📊</div>
            <p>No quiz sessions yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsTab() {
  const { data: settings, refetch } = trpc.admin.getSettings.useQuery();
  const updateMutation = trpc.admin.updateSetting.useMutation({
    onSuccess: () => { refetch(); toast.success("Saved!"); },
  });

  const [webhookUrl, setWebhookUrl] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  useEffect(() => {
    if (settings) {
      const wh = settings.find((s) => s.key === "webhook_url");
      const wa = settings.find((s) => s.key === "whatsapp_number");
      if (wh?.value) setWebhookUrl(wh.value);
      if (wa?.value) setWhatsapp(wa.value);
    }
  }, [settings]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="text-white font-semibold mb-1">Webhook URL</div>
        <p className="text-white/40 text-xs mb-3">POST request with full recipe and answers on every quiz completion.</p>
        <textarea
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          rows={3}
          className="w-full rounded-md px-3 py-2.5 text-white placeholder-white/30 outline-none mb-3 text-sm resize-none"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          placeholder="https://..."
        />
        <button onClick={() => updateMutation.mutate({ key: "webhook_url", value: webhookUrl })}
          disabled={updateMutation.isPending}
          className="rounded-md px-4 py-2 font-bold text-black text-sm disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
          {updateMutation.isPending ? "Saving..." : "Save Webhook"}
        </button>
      </div>

      <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="text-white font-semibold mb-1">WhatsApp Number</div>
        <p className="text-white/40 text-xs mb-3">Bartender's number for order notifications.</p>
        <input
          type="text"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          className="w-full rounded-md px-3 py-2.5 text-white placeholder-white/30 outline-none mb-3 text-sm"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          placeholder="+32..."
        />
        <button onClick={() => updateMutation.mutate({ key: "whatsapp_number", value: whatsapp })}
          disabled={updateMutation.isPending}
          className="rounded-md px-4 py-2 font-bold text-black text-sm disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #a855f7, #22d3ee)" }}>
          {updateMutation.isPending ? "Saving..." : "Save Number"}
        </button>
      </div>

      <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="text-white font-semibold mb-2">System info</div>
        <div className="text-white/40 text-xs space-y-1">
          <p>Bar: The Beast Bar, Indonesia</p>
          <p>AI model: Claude by Anthropic</p>
          <p>Flavor model: 15-principle psychology</p>
          <p>Measurements: milliliters only</p>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("ingredients");
  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => setIsLoggedIn(false) });
  const { data: authData } = trpc.admin.checkAuth.useQuery();

  useEffect(() => {
    if (authData?.authenticated) setIsLoggedIn(true);
  }, [authData]);

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />;
  }

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: "ingredients", label: "Ingredients", icon: "🍹" },
    { id: "sessions", label: "Sessions", icon: "📊" },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar layout for desktop, top nav for mobile */}
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar (desktop) */}
        <aside className="hidden sm:flex flex-col w-56 flex-shrink-0 border-r border-white/8"
          style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="px-5 py-5 border-b border-white/8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md flex items-center justify-center text-lg"
                style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>🍹</div>
              <div>
                <div className="font-display text-sm font-bold text-white">Beast Bar</div>
                <div className="text-white/40 text-xs">Admin Panel</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 text-left"
                style={{
                  background: activeTab === tab.id ? "rgba(255,107,53,0.15)" : "transparent",
                  color: activeTab === tab.id ? "#ff6b35" : "rgba(255,255,255,0.5)",
                  border: activeTab === tab.id ? "1px solid rgba(255,107,53,0.3)" : "1px solid transparent",
                }}>
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="px-3 py-4 border-t border-white/8">
            <button onClick={() => logoutMutation.mutate()}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-white/40 hover:text-white/70 transition-colors"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <span>🚪</span> Log out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile top bar */}
          <div className="sm:hidden sticky top-0 z-20 px-4 py-3 flex items-center justify-between"
            style={{ background: "rgba(9,9,20,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display text-lg font-bold text-white">Beast Bar Admin</div>
            <button onClick={() => logoutMutation.mutate()}
              className="rounded-md px-3 py-1.5 text-xs text-white/50 hover:text-white transition-colors"
              style={{ background: "rgba(255,255,255,0.06)" }}>
              Log out
            </button>
          </div>

          {/* Mobile tab nav */}
          <div className="sm:hidden px-4 py-2 border-b border-white/8"
            style={{ background: "rgba(9,9,20,0.9)" }}>
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="flex-1 flex items-center justify-center gap-1 rounded-md py-2 text-xs font-semibold transition-all duration-150"
                  style={{
                    background: activeTab === tab.id ? "rgba(255,107,53,0.2)" : "transparent",
                    color: activeTab === tab.id ? "#ff6b35" : "rgba(255,255,255,0.4)",
                  }}>
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Desktop page header */}
          <div className="hidden sm:block px-6 py-5 border-b border-white/8">
            <h2 className="font-display text-2xl font-bold text-white">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <p className="text-white/40 text-sm mt-0.5">
              {activeTab === "ingredients" && "Toggle what's in stock. Claude only uses available ingredients."}
              {activeTab === "sessions" && "All quiz completions and generated cocktails."}
              {activeTab === "settings" && "Webhook and notification settings."}
            </p>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-16">
            {activeTab === "ingredients" && <IngredientsTab />}
            {activeTab === "sessions" && <SessionsTab />}
            {activeTab === "settings" && <SettingsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
