import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import QRCodeLib from "qrcode";
import { jsPDF } from "jspdf";
import { translateIngredientName } from "@shared/ingredientTranslations";

type AdminTab = "ingredients" | "orders" | "qrcodes" | "shop" | "settings";

const CATEGORIES = ["spirits", "liqueurs", "mixers", "juices", "syrups", "bitters", "garnishes", "other"];

const CATEGORY_LABELS: Record<string, string> = {
  spirits: "Sterkedrank", liqueurs: "Likeuren", mixers: "Mixers", juices: "Sappen",
  syrups: "Siropen", bitters: "Bitters", garnishes: "Garnering", other: "Overig",
};

const CATEGORY_COLORS: Record<string, string> = {
  spirits: "#ff6b35", liqueurs: "#a855f7", mixers: "#22d3ee", juices: "#f59e0b",
  syrups: "#ec4899", bitters: "#10b981", garnishes: "#6366f1", other: "#94a3b8",
};

// ── Canvas helpers (used by QR tab) ─────────────────────────────────────────

function measureTextSpaced(ctx: CanvasRenderingContext2D, text: string, sp: number) {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += ctx.measureText(text[i]).width;
    if (i < text.length - 1) w += sp;
  }
  return w;
}

function drawTextSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], cx, y);
    cx += ctx.measureText(text[i]).width + sp;
  }
}

function drawRadialBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const tmp = document.createElement("canvas");
  tmp.width = r * 2; tmp.height = r * 2;
  const tc = tmp.getContext("2d")!;
  const rg = tc.createRadialGradient(r, r, 0, r, r, r);
  rg.addColorStop(0, color); rg.addColorStop(1, "transparent");
  tc.fillStyle = rg;
  tc.beginPath(); tc.arc(r, r, r, 0, Math.PI * 2); tc.fill();
  ctx.drawImage(tmp, x - r, y - r);
}

function qrGradientFor(ctx: CanvasRenderingContext2D, gradIdx: number, size: number): CanvasGradient {
  let g: CanvasGradient;
  if (gradIdx === 0) {
    g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "#ff9a00"); g.addColorStop(0.45, "#ff3cac"); g.addColorStop(1, "#9b59b6");
  } else if (gradIdx === 1) {
    g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "#ff9a00"); g.addColorStop(0.2, "#ff6b35"); g.addColorStop(0.45, "#ff3cac");
    g.addColorStop(0.72, "#c800ff"); g.addColorStop(1, "#7b2fff");
  } else if (gradIdx === 2) {
    g = ctx.createConicGradient(0, size / 2, size / 2);
    g.addColorStop(0, "#ff9a00"); g.addColorStop(0.25, "#ff3cac"); g.addColorStop(0.5, "#9b59b6");
    g.addColorStop(0.75, "#3b82f6"); g.addColorStop(1, "#ff9a00");
  } else {
    g = ctx.createRadialGradient(size * 0.3, size * 0.3, 0, size / 2, size / 2, size * 0.75);
    g.addColorStop(0, "#ff9a00"); g.addColorStop(0.4, "#ff3cac"); g.addColorStop(1, "#9b59b6");
  }
  return g;
}

// Renders a QR code where connected runs of dark modules merge into solid,
// seamless blocks (like a normal QR code) — only the corners that are
// actually exposed (neither adjacent edge-neighbor is also dark) get rounded
// off. A corner shared with a dark neighbor stays a hard 90° angle, so runs
// of modules read as one continuous rounded-pill/blob shape instead of a
// grid of separate dots with visible gaps.
function renderRoundedQR(text: string, size: number, gradIdx: number): HTMLCanvasElement {
  const qrData = QRCodeLib.create(text, { errorCorrectionLevel: "H" });
  const modules = qrData.modules;
  const count = modules.size;
  const margin = 2; // quiet-zone modules
  const cell = size / (count + margin * 2);
  const isDark = (row: number, col: number): boolean =>
    row >= 0 && row < count && col >= 0 && col < count && !!modules.get(row, col);

  const out = document.createElement("canvas");
  out.width = size; out.height = size;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = qrGradientFor(ctx, gradIdx, size);
  // No gap — modules that touch a dark neighbor connect with zero seam.
  const r = Math.max(1, cell * 0.42);
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!isDark(row, col)) continue;
      const top = isDark(row - 1, col);
      const bottom = isDark(row + 1, col);
      const left = isDark(row, col - 1);
      const right = isDark(row, col + 1);
      const rTL = top || left ? 0 : r;
      const rTR = top || right ? 0 : r;
      const rBR = bottom || right ? 0 : r;
      const rBL = bottom || left ? 0 : r;

      const x = (col + margin) * cell;
      const y = (row + margin) * cell;
      const w = cell;
      const h = cell;
      ctx.beginPath();
      ctx.moveTo(x + rTL, y);
      ctx.lineTo(x + w - rTR, y);
      if (rTR) ctx.quadraticCurveTo(x + w, y, x + w, y + rTR);
      ctx.lineTo(x + w, y + h - rBR);
      if (rBR) ctx.quadraticCurveTo(x + w, y + h, x + w - rBR, y + h);
      ctx.lineTo(x + rBL, y + h);
      if (rBL) ctx.quadraticCurveTo(x, y + h, x, y + h - rBL);
      ctx.lineTo(x, y + rTL);
      if (rTL) ctx.quadraticCurveTo(x, y, x + rTL, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  return out;
}

// Draws the real Cocktailored cocktail-glass logo image in the center of a QR
// canvas, on top of a small, barely-rounded background square so the QR
// scanner still reads the surrounding modules cleanly.
function drawCenterLogo(canvas: HTMLCanvasElement, logoImg: HTMLImageElement): void {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width;
  const logoSize = size * 0.18;
  const pad = logoSize * 0.16;
  const boxSize = logoSize + pad * 2;
  const bx = (size - boxSize) / 2;
  const by = (size - boxSize) / 2;

  const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  ctx.save();
  ctx.fillStyle = "#0d0d0d";
  roundedRect(bx, by, boxSize, boxSize, boxSize * 0.06);
  ctx.fill();

  ctx.save();
  roundedRect(bx, by, boxSize, boxSize, boxSize * 0.06);
  ctx.clip();
  const lx = (size - logoSize) / 2;
  const ly = (size - logoSize) / 2;
  ctx.drawImage(logoImg, lx, ly, logoSize, logoSize);
  ctx.restore();
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function buildCardCanvas(qrCanvas: HTMLCanvasElement, outerRadius = 56): HTMLCanvasElement {
  // QR 620 (not 640) so the brand footer can sit higher: the header's ink
  // starts ~46px from the top, and the footer's ink now ends ~46px from the
  // bottom — equal top/bottom margins.
  const SIZE = 900, QR = 620;
  const off = document.createElement("canvas");
  off.width = SIZE; off.height = SIZE;
  const ctx = off.getContext("2d")!;
  const r = outerRadius;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(SIZE - r, 0); ctx.quadraticCurveTo(SIZE, 0, SIZE, r);
  ctx.lineTo(SIZE, SIZE - r); ctx.quadraticCurveTo(SIZE, SIZE, SIZE - r, SIZE);
  ctx.lineTo(r, SIZE); ctx.quadraticCurveTo(0, SIZE, 0, SIZE - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath(); ctx.clip();
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, SIZE, SIZE);
  drawRadialBlob(ctx, 0, 0, 280, "rgba(180,60,20,0.55)");
  drawRadialBlob(ctx, SIZE, SIZE, 300, "rgba(60,20,100,0.65)");
  drawRadialBlob(ctx, 0, SIZE, 220, "rgba(10,80,80,0.5)");
  ctx.textBaseline = "middle";
  // Slogan sits ABOVE the QR code, bigger and split across two lines.
  const SSP = 4;
  ctx.font = "700 36px system-ui, sans-serif";
  const slLine1 = "ORDER YOUR";
  const sW1 = measureTextSpaced(ctx, slLine1, SSP);
  const sG = ctx.createLinearGradient((SIZE - sW1) / 2, 0, (SIZE - sW1) / 2 + sW1, 0);
  sG.addColorStop(0, "#ff9a00"); sG.addColorStop(0.5, "#ff3cac"); sG.addColorStop(1, "#9b59b6");
  ctx.fillStyle = sG;
  drawTextSpaced(ctx, slLine1, (SIZE - sW1) / 2, 64, SSP);
  // Line 2: "PERSONALIZED" white (matches the "Cocktail" brand styling) and
  // slightly bigger, "COCKTAIL" keeps the gradient.
  ctx.font = "700 39px system-ui, sans-serif";
  const word1 = "PERSONALIZED ";
  const word2 = "COCKTAIL";
  const w1W = measureTextSpaced(ctx, word1, SSP);
  const w2W = measureTextSpaced(ctx, word2, SSP);
  const line2StartX = (SIZE - (w1W + w2W)) / 2;
  ctx.fillStyle = "#ffffff";
  drawTextSpaced(ctx, word1, line2StartX, 106, SSP);
  const sG2 = ctx.createLinearGradient(line2StartX + w1W, 0, line2StartX + w1W + w2W, 0);
  sG2.addColorStop(0, "#ff9a00"); sG2.addColorStop(0.5, "#ff3cac"); sG2.addColorStop(1, "#9b59b6");
  ctx.fillStyle = sG2;
  drawTextSpaced(ctx, word2, line2StartX + w1W, 106, SSP);
  const qrBox = document.createElement("canvas");
  qrBox.width = QR; qrBox.height = QR;
  const qc = qrBox.getContext("2d")!;
  const ir = 6, pw = QR * 0.02;
  const roundedPath = (c: CanvasRenderingContext2D, w: number, h: number, rr: number) => {
    c.beginPath();
    c.moveTo(rr, 0); c.lineTo(w - rr, 0); c.quadraticCurveTo(w, 0, w, rr);
    c.lineTo(w, h - rr); c.quadraticCurveTo(w, h, w - rr, h);
    c.lineTo(rr, h); c.quadraticCurveTo(0, h, 0, h - rr);
    c.lineTo(0, rr); c.quadraticCurveTo(0, 0, rr, 0);
    c.closePath();
  };
  qc.fillStyle = "#0a0a0a"; qc.strokeStyle = "rgba(255,255,255,0.07)"; qc.lineWidth = 3;
  roundedPath(qc, QR, QR, ir); qc.fill(); qc.stroke();
  qc.save(); roundedPath(qc, QR, QR, ir); qc.clip();
  qc.drawImage(qrCanvas, pw, pw, QR - pw * 2, QR - pw * 2);
  qc.restore();
  ctx.drawImage(qrBox, (SIZE - QR) / 2, (SIZE - QR) / 2 + 10);
  // Brand name now sits BELOW the QR code.
  ctx.font = "800 76px system-ui, sans-serif";
  const SP = 2;
  const cW = measureTextSpaced(ctx, "Cocktail", SP);
  const oW = measureTextSpaced(ctx, "ored", SP);
  const sx = (SIZE - cW - oW) / 2;
  ctx.fillStyle = "#ffffff";
  drawTextSpaced(ctx, "Cocktail", sx, SIZE - 84, SP);
  const gT = ctx.createLinearGradient(sx + cW, 0, sx + cW + oW, 0);
  gT.addColorStop(0, "#ff3cac"); gT.addColorStop(1, "#9b59b6");
  ctx.fillStyle = gT;
  drawTextSpaced(ctx, "ored", sx + cW, SIZE - 84, SP);
  ctx.restore();
  return off;
}

// ── Login ────────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const loginMutation = trpc.admin.login.useMutation();

  const handleLogin = async () => {
    if (!username || !password) { setError("Vul beide velden in."); return; }
    try {
      await loginMutation.mutateAsync({ username, password });
      onLogin();
    } catch {
      setError("Verkeerde inloggegevens. Probeer opnieuw.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute liquid-blob" style={{ width: 320, height: 320, background: "#ff6b35", opacity: 0.08, top: "5%", left: "-8%" }} />
      <div className="absolute liquid-blob" style={{ width: 260, height: 260, background: "#a855f7", opacity: 0.08, bottom: "8%", right: "-6%", animationDelay: "3s" }} />
      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg mb-4" style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
            <span className="text-3xl">🍹</span>
          </div>
          <h1 className="font-display text-3xl font-bold text-white">Beast Bar Admin</h1>
          <p className="text-white/40 text-sm mt-1">Beheer je bar</p>
        </div>
        <div className="rounded-lg p-6" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <label className="block text-white/60 text-xs uppercase tracking-wider mb-1.5">Gebruikersnaam</label>
          <input type="text" value={username} onChange={(e) => { setUsername(e.target.value); setError(""); }} placeholder="Gebruikersnaam"
            className="w-full rounded-md px-4 py-3 text-white placeholder-white/30 outline-none mb-4"
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }} />
          <label className="block text-white/60 text-xs uppercase tracking-wider mb-1.5">Wachtwoord</label>
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="Wachtwoord"
            className="w-full rounded-md px-4 py-3 text-white placeholder-white/30 outline-none mb-5"
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }} />
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button onClick={handleLogin} disabled={loginMutation.isPending}
            className="w-full rounded-md py-3 font-bold text-black transition-all duration-200 active:scale-95 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
            {loginMutation.isPending ? "Inloggen..." : "Inloggen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ingredient toggle ────────────────────────────────────────────────────────

function IngredientToggle({ available, onChange }: { available: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="relative w-10 h-5 rounded-full transition-all duration-200 flex-shrink-0"
      style={{ background: available ? "linear-gradient(135deg, #10b981, #22d3ee)" : "rgba(255,255,255,0.12)" }}>
      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200"
        style={{ left: available ? "calc(100% - 1.125rem)" : "0.125rem" }} />
    </button>
  );
}

// ── Ingredients tab ──────────────────────────────────────────────────────────

function IngredientsTab() {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("all");
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("spirits");
  const [showAddForm, setShowAddForm] = useState(false);

  const utils = trpc.useUtils();
  const { data: ingredients, refetch } = trpc.admin.getIngredients.useQuery();

  // Optimistic toggle: flip the switch instantly, roll back + warn on failure,
  // and reconcile with the server afterwards. Prevents the switch from silently
  // "sticking" or jumping back when a mutation is slow or fails.
  const updateMutation = trpc.admin.updateIngredient.useMutation({
    onMutate: async ({ id, available }) => {
      await utils.admin.getIngredients.cancel();
      const prev = utils.admin.getIngredients.getData();
      utils.admin.getIngredients.setData(undefined, (old) =>
        old?.map((i) => (i.id === id ? { ...i, available } : i)));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.admin.getIngredients.setData(undefined, ctx.prev);
      toast.error("Kon voorraad niet bijwerken. Probeer opnieuw.");
    },
    onSettled: () => utils.admin.getIngredients.invalidate(),
  });
  const addMutation = trpc.admin.addIngredient.useMutation({
    onSuccess: () => { refetch(); setNewName(""); setShowAddForm(false); toast.success("Ingrediënt toegevoegd!"); },
    onError: () => { toast.error("Kon ingrediënt niet toevoegen. Probeer opnieuw."); },
  });
  const deleteMutation = trpc.admin.deleteIngredient.useMutation({
    onSuccess: () => { refetch(); toast.success("Ingrediënt verwijderd."); },
    onError: () => { toast.error("Kon ingrediënt niet verwijderen. Probeer opnieuw."); },
  });

  const filtered = useMemo(() => (ingredients ?? []).filter((i) => {
    const matchesCat = activeCat === "all" || i.category === activeCat;
    const matchesSearch = i.name.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  }), [ingredients, activeCat, search]);

  const availableCount = (ingredients ?? []).filter((i) => i.available).length;
  const totalCount = (ingredients ?? []).length;

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
      <div className="grid grid-cols-3 gap-3">
        {[
          { val: availableCount, label: "Op voorraad", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.25)" },
          { val: totalCount - availableCount, label: "Niet op voorraad", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.25)" },
          { val: totalCount, label: "Totaal", bg: "rgba(255,107,53,0.12)", border: "rgba(255,107,53,0.25)" },
        ].map((s) => (
          <div key={s.label} className="rounded-md p-3 text-center" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
            <div className="font-display text-2xl font-bold text-white">{s.val}</div>
            <div className="text-white/50 text-xs">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">🔍</span>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek ingrediënten..."
          className="w-full rounded-md pl-9 pr-4 py-2.5 text-white placeholder-white/30 outline-none text-sm"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 text-sm">✕</button>}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {["all", ...CATEGORIES].map((cat) => {
          const isActive = activeCat === cat;
          const color = cat === "all" ? "#ff6b35" : CATEGORY_COLORS[cat];
          return (
            <button key={cat} onClick={() => setActiveCat(cat)} className="rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150"
              style={{ background: isActive ? `${color}25` : "rgba(255,255,255,0.05)", border: isActive ? `1.5px solid ${color}` : "1px solid rgba(255,255,255,0.08)", color: isActive ? color : "rgba(255,255,255,0.5)" }}>
              {cat === "all" ? `Alles (${totalCount})` : CATEGORY_LABELS[cat]}
            </button>
          );
        })}
      </div>
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-8 text-white/30 text-sm">Geen ingrediënten gevonden.</div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: CATEGORY_COLORS[cat] ?? "#94a3b8" }} />
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">{CATEGORY_LABELS[cat] ?? cat} ({items.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {items.map((ing) => (
                <div key={ing.id} className="flex items-center justify-between rounded-md px-3 py-2.5 group"
                  style={{ background: ing.available ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.03)", border: ing.available ? "1px solid rgba(16,185,129,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <IngredientToggle available={ing.available} onChange={() => updateMutation.mutate({ id: ing.id, available: !ing.available })} />
                    <span className={`text-sm truncate ${ing.available ? "text-white" : "text-white/40 line-through"}`}>{translateIngredientName(ing.name)}</span>
                  </div>
                  {ing.isCustom && (
                    <button onClick={() => deleteMutation.mutate({ id: ing.id })}
                      className="text-red-400/40 hover:text-red-400 text-xs transition-colors ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100">
                      Verwijder
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <div className="border-t border-white/8 pt-4">
        {showAddForm ? (
          <div className="rounded-md p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="text-white font-semibold text-sm mb-3">Eigen ingrediënt toevoegen</div>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Naam ingrediënt..."
              className="w-full rounded-md px-3 py-2.5 text-white placeholder-white/30 outline-none mb-2 text-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }} autoFocus />
            <select value={newCat} onChange={(e) => setNewCat(e.target.value)}
              className="w-full rounded-md px-3 py-2.5 text-white outline-none mb-3 text-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}>
              {CATEGORIES.map((c) => <option key={c} value={c} style={{ background: "#0d0d1a" }}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => addMutation.mutate({ name: newName, category: newCat })}
                disabled={!newName.trim() || addMutation.isPending}
                className="flex-1 rounded-md py-2.5 font-bold text-black text-sm disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
                {addMutation.isPending ? "Toevoegen..." : "Toevoegen"}
              </button>
              <button onClick={() => setShowAddForm(false)}
                className="rounded-md px-4 py-2.5 text-white/50 text-sm hover:text-white transition-colors"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                Annuleren
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddForm(true)}
            className="w-full rounded-md py-2.5 font-semibold text-white/50 text-sm transition-all duration-150 hover:text-white hover:border-white/30"
            style={{ background: "rgba(255,255,255,0.03)", border: "1.5px dashed rgba(255,255,255,0.15)" }}>
            + Eigen ingrediënt toevoegen
          </button>
        )}
      </div>
    </div>
  );
}

// ── Orders tab ───────────────────────────────────────────────────────────────

type AdminRecipe = {
  name: string;
  colorHex: string;
  tagline?: string;
  spiritBase?: string;
  ingredients: Array<{ name: string; amount: number; unit: string }>;
  instructions: string[];
  flavorNotes?: string[];
  profileExplanation?: string;
};

const SERVED_KEY = "bb_served_map";
const ONE_HOUR = 60 * 60 * 1000;
// Served entries only need to stick around long enough to (a) show in the
// 1-hour trash grace window and (b) keep the session out of the active list
// forever after. Pruning on THAT same 1-hour threshold would un-serve the
// order the moment it aged out of localStorage, making it pop back into
// Bestellingen as if never served — so storage cleanup uses a much longer
// window purely to cap growth, not to expire "served" status itself.
const SERVED_STORAGE_TTL = 90 * 24 * ONE_HOUR;

function loadServedMap(): Map<number, number> {
  try {
    const raw = localStorage.getItem(SERVED_KEY);
    if (!raw) return new Map();
    const obj: Record<string, number> = JSON.parse(raw);
    const now = Date.now();
    const m = new Map<number, number>();
    for (const [k, v] of Object.entries(obj)) {
      if (now - v < SERVED_STORAGE_TTL) m.set(Number(k), v);
    }
    return m;
  } catch { return new Map(); }
}

function saveServedMap(m: Map<number, number>) {
  const obj: Record<string, number> = {};
  m.forEach((v, k) => { obj[k] = v; });
  localStorage.setItem(SERVED_KEY, JSON.stringify(obj));
}

function getTableNumber(session: { answers: unknown }): string | undefined {
  const answers = session.answers as Array<{ questionId: number; answer: string }> | null;
  return answers?.find((a) => a.questionId === -1)?.answer;
}

function OrdersTab() {
  const { data: sessions } = trpc.admin.getSessions.useQuery();
  const [servedMap, setServedMap] = useState<Map<number, number>>(() => loadServedMap());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showTrash, setShowTrash] = useState(false);

  const markServed = (id: number) =>
    setServedMap((prev) => { const m = new Map(prev); m.set(id, Date.now()); saveServedMap(m); return m; });

  const unmarkServed = (id: number) =>
    setServedMap((prev) => { const m = new Map(prev); m.delete(id); saveServedMap(m); return m; });

  // Empties the trash view immediately instead of waiting out the 1-hour
  // grace window — ages every currently-trashed timestamp past ONE_HOUR so
  // it drops out of the trash filter, while staying in servedMap so the
  // order does NOT reappear as active.
  const emptyTrash = () =>
    setServedMap((prev) => {
      const m = new Map(prev);
      const expired = Date.now() - ONE_HOUR - 1000;
      trashSessions.forEach((s) => m.set(s.id, expired));
      saveServedMap(m);
      return m;
    });

  // Only sessions where client actually pressed Order
  const orderedSessions = useMemo(() =>
    (sessions ?? []).filter((s) => s.orderSubmitted),
    [sessions]
  );

  const hasRecipe = (s: (typeof orderedSessions)[number]) => {
    const recipes = s.recipes as AdminRecipe[] | null;
    const idx = s.selectedRecipeIndex ?? 0;
    return !!recipes?.[idx]?.name;
  };

  // Orders with no generated recipe attached (e.g. from a since-fixed
  // generation failure) are always hidden — never shown to whoever's
  // running this tablet, no toggle needed.
  const activeSessions = useMemo(() =>
    orderedSessions.filter((s) => !servedMap.has(s.id) &&
      (s.guestName ?? "").toLowerCase().includes(search.toLowerCase()) &&
      hasRecipe(s)),
    [orderedSessions, servedMap, search]
  );

  const now = Date.now();
  const trashSessions = useMemo(() =>
    orderedSessions.filter((s) => {
      const t = servedMap.get(s.id);
      return t !== undefined && now - t < ONE_HOUR;
    }),
    [orderedSessions, servedMap]
  );

  const selectedSession = sessions?.find((s) => s.id === selectedId);

  if (showTrash) {
    return (
      <div>
        <button onClick={() => setShowTrash(false)}
          className="flex items-center gap-2 text-white/50 hover:text-white text-sm mb-5 transition-colors">
          ← Terug naar bestellingen
        </button>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-white">Prullenbak</h3>
            <p className="text-white/40 text-xs mt-0.5">Geserveerde bestellingen — automatisch verwijderd na 1 uur.</p>
          </div>
          {trashSessions.length > 0 && (
            <button onClick={emptyTrash}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all"
              style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
              🗑 Leeg prullenbak
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {trashSessions.length === 0 ? (
            <div className="text-center py-10 text-white/30">
              <div className="text-4xl mb-3">🗑</div>
              <p>Prullenbak is leeg.</p>
            </div>
          ) : trashSessions.map((session) => {
            const recipes = session.recipes as AdminRecipe[] | null;
            const idx = session.selectedRecipeIndex ?? 0;
            const recipe = recipes?.[idx];
            const servedAt = servedMap.get(session.id)!;
            const minutesAgo = Math.round((now - servedAt) / 60000);
            return (
              <div key={session.id} className="rounded-md px-4 py-3.5 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <div className="text-white/60 font-semibold text-sm">{session.guestName ?? "Anoniem"}</div>
                  <div className="text-white/30 text-xs mt-0.5">
                    {recipe?.name && <span>{recipe.name} · </span>}
                    Geserveerd {minutesAgo === 0 ? "zojuist" : `${minutesAgo} min. geleden`}
                  </div>
                </div>
                <button onClick={() => unmarkServed(session.id)}
                  className="text-xs rounded px-3 py-1.5 font-semibold transition-all hover:bg-white/10"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  Terugzetten
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    const recipes = selectedSession.recipes as AdminRecipe[] | null;
    const idx = selectedSession.selectedRecipeIndex ?? 0;
    const recipe = recipes?.[idx];
    const isServed = servedMap.has(selectedSession.id);

    return (
      <div style={{ paddingBottom: recipe ? "128px" : 0 }}>
        <button onClick={() => setSelectedId(null)}
          className="flex items-center gap-2 text-white/50 hover:text-white text-sm mb-5 transition-colors">
          ← Terug naar bestellingen
        </button>

        <div className="mb-5">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-xl font-bold text-white">{selectedSession.guestName ?? "Anoniem"}</h3>
            {getTableNumber(selectedSession) && (
              <span className="text-xs font-bold rounded-full px-2.5 py-1"
                style={{ background: "rgba(255,107,53,0.15)", color: "#ff6b35", border: "1px solid rgba(255,107,53,0.3)" }}>
                Tafel {getTableNumber(selectedSession)}
              </span>
            )}
          </div>
          <p className="text-white/40 text-xs mt-0.5">
            {new Date(selectedSession.createdAt).toLocaleDateString("nl-NL")} om{" "}
            {new Date(selectedSession.createdAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        {recipe && (
          <>
            <div className="rounded-md p-4 mb-4" style={{ background: `${recipe.colorHex}18`, border: `1.5px solid ${recipe.colorHex}40` }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex-shrink-0" style={{ background: recipe.colorHex, boxShadow: `0 0 14px ${recipe.colorHex}66` }} />
                <div>
                  <div className="font-display text-xl font-bold text-white">{recipe.name}</div>
                  {recipe.tagline && <div className="text-white/50 text-xs mt-0.5">{recipe.tagline}</div>}
                </div>
              </div>
            </div>

            <div className="rounded-md p-4 mb-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-white/40 text-xs uppercase tracking-wider mb-3">🧪 Ingrediënten</div>
              <div className="flex flex-col gap-2">
                {(recipe.ingredients ?? []).map((ing, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md px-3.5 py-2.5"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="text-white text-sm font-medium">{translateIngredientName(ing.name)}</span>
                    <span className="font-bold text-sm" style={{ color: recipe.colorHex }}>{ing.amount} {ing.unit}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md p-4 mb-5" style={{ background: "rgba(255,255,255,0.04)", border: `1.5px solid ${recipe.colorHex}30` }}>
              <div className="text-white/40 text-xs uppercase tracking-wider mb-3">🍸 Hoe maak je het</div>
              <div className="flex flex-col gap-3">
                {(recipe.instructions ?? []).map((step, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-black"
                      style={{ background: recipe.colorHex, marginTop: "1px" }}>
                      {i + 1}
                    </div>
                    <p className="text-white/85 text-sm leading-relaxed pt-1">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Fixed at the bottom of the viewport — overlaid on top of the
                scrollable recipe/ingredients/instructions above, so it's
                always visible and reachable no matter how far you scroll. */}
            <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pt-3 pb-5"
              style={{ background: "linear-gradient(180deg, transparent, rgba(10,10,10,0.85) 30%)" }}>
              <div style={{ width: "100%", maxWidth: "480px", margin: "0 auto" }}>
                {isServed ? (
                  <div className="rounded-md p-5 text-center" style={{ background: "rgba(16,185,129,0.1)", border: "2px solid rgba(16,185,129,0.4)" }}>
                    <div className="text-3xl mb-2">✅</div>
                    <div className="font-bold text-white text-lg">Geserveerd!</div>
                    <p className="text-white/50 text-xs mt-1">Cocktail is aan de gast overhandigd.</p>
                    <button onClick={() => { unmarkServed(selectedSession.id); setSelectedId(null); }}
                      className="mt-3 text-white/30 hover:text-white/60 text-xs underline transition-colors">
                      Ongedaan maken
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { markServed(selectedSession.id); setSelectedId(null); }}
                    className="w-full rounded-md py-4 text-lg font-bold text-white transition-all duration-200 active:scale-95"
                    style={{ background: "linear-gradient(135deg, #10b981, #22d3ee)", boxShadow: "0 0 32px rgba(16,185,129,0.4)" }}>
                    ✓ Markeer als geserveerd
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-sm">{activeSessions.length} bestellingen</span>
          {trashSessions.length > 0 && (
            <button onClick={() => setShowTrash(true)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all hover:text-white/70"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              🗑 {trashSessions.length}
            </button>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">🔍</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek op naam..."
            className="rounded-md pl-7 pr-3 py-2 text-white placeholder-white/30 outline-none text-xs"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", width: "160px" }} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {activeSessions.map((session) => {
          const recipes = session.recipes as AdminRecipe[] | null;
          const idx = session.selectedRecipeIndex ?? 0;
          const recipe = recipes?.[idx];
          return (
            <div key={session.id} role="button" tabIndex={0}
              onClick={() => setSelectedId(session.id)}
              onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(session.id); }}
              className="w-full rounded-md overflow-hidden text-left transition-all duration-150 hover:border-white/20 cursor-pointer"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  {recipe?.colorHex && (
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: recipe.colorHex }} />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="text-white font-semibold text-sm">{session.guestName ?? "Anoniem"}</div>
                      {getTableNumber(session) && (
                        <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 flex-shrink-0"
                          style={{ background: "rgba(255,107,53,0.15)", color: "#ff6b35", border: "1px solid rgba(255,107,53,0.3)" }}>
                          T{getTableNumber(session)}
                        </span>
                      )}
                    </div>
                    <div className="text-white/40 text-xs mt-0.5 truncate">
                      {new Date(session.createdAt).toLocaleDateString("nl-NL")} om{" "}
                      {new Date(session.createdAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                      {recipe?.name && <span className="ml-2 text-white/30">· {recipe.name}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); markServed(session.id); }}
                    title="Markeer als geserveerd"
                    className="rounded-md px-2.5 py-1.5 text-xs font-bold transition-all active:scale-95"
                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.35)", color: "#10b981" }}>
                    ✓ Geserveerd
                  </button>
                  <span className="text-white/30 text-sm">→</span>
                </div>
              </div>
            </div>
          );
        })}
        {activeSessions.length === 0 && (
          <div className="text-center py-12 text-white/30">
            <div className="text-4xl mb-3">🍹</div>
            <p>Geen openstaande bestellingen.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── QR Codes tab ─────────────────────────────────────────────────────────────

const QR_URL = "https://cocktailored.ai";

function QRCodesTab() {
  const [cardDataUrl, setCardDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"home" | "stickers">("home");
  const [stickerQty, setStickerQty] = useState(5);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [orderDone, setOrderDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const size = 400;
        const styled = renderRoundedQR(QR_URL, size, 0);
        const logoImg = await loadImage("/brand/cocktail-logo.jpeg");
        if (cancelled) return;
        drawCenterLogo(styled, logoImg);
        const card = buildCardCanvas(styled);
        setCardDataUrl(card.toDataURL("image/png"));
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const downloadPDF = () => {
    if (!cardDataUrl) return;
    const mmSize = 90;
    const doc = new jsPDF({ unit: "mm", format: [mmSize, mmSize], orientation: "portrait" });
    doc.addImage(cardDataUrl, "PNG", 0, 0, mmSize, mmSize);
    doc.save("cocktailored-qr.pdf");
  };

  const downloadPNG = () => {
    if (!cardDataUrl) return;
    const a = document.createElement("a");
    a.download = "cocktailored-qr-kaartje.png";
    a.href = cardDataUrl;
    a.click();
  };

  const placeOrder = async () => {
    if (!contactName.trim() || !contactEmail.trim() || !contactAddress.trim()) {
      toast.error("Vul alle velden in."); return;
    }
    setOrdering(true);
    await new Promise((r) => setTimeout(r, 2200));
    setOrderDone(true);
    setOrdering(false);
  };

  const stickerPrice = (stickerQty / 5) * 10;

  if (view === "stickers") {
    return (
      <div>
        <button onClick={() => { setView("home"); setOrderDone(false); }}
          className="flex items-center gap-2 text-white/50 hover:text-white text-sm mb-5 transition-colors">
          ← Terug
        </button>

        {orderDone ? (
          <div className="flex flex-col items-center text-center py-8">
            <div className="text-6xl mb-4">🎉</div>
            <h3 className="font-display text-2xl font-bold text-white mb-2">Bestelling geplaatst!</h3>
            <p className="text-white/60 mb-1">Je {stickerQty} QR stickers worden vers gedrukt en verstuurd.</p>
            <p className="text-white/40 text-sm">Verwachte levertijd: 3–5 werkdagen.</p>
            <div className="mt-6 rounded-md p-4 text-left w-full max-w-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="text-white/40 text-xs uppercase tracking-wider mb-2">Samenvatting</div>
              <div className="flex justify-between text-sm mb-1"><span className="text-white/60">Stickers</span><span className="text-white font-bold">{stickerQty}x</span></div>
              <div className="flex justify-between text-sm mb-1"><span className="text-white/60">Prijs per 5</span><span className="text-white">€10,00</span></div>
              <div className="flex justify-between text-sm border-t border-white/10 pt-2 mt-2"><span className="text-white font-semibold">Totaal</span><span className="font-bold" style={{ color: "#ff6b35" }}>€{stickerPrice.toFixed(2)}</span></div>
            </div>
            <button onClick={() => { setOrderDone(false); setView("home"); }}
              className="mt-5 text-white/30 hover:text-white/60 text-sm underline transition-colors">
              Nieuwe bestelling
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {cardDataUrl && (
              <img src={cardDataUrl} alt="QR kaartje preview" className="w-full max-w-xs mx-auto rounded-xl" />
            )}
            <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div className="font-semibold text-white mb-1">Aantal stickers</div>
              <p className="text-white/40 text-xs mb-3">Per 5 stuks voor €10,00.</p>
              <div className="flex gap-2 flex-wrap mb-3">
                {[5, 10, 15, 20, 25, 50].map((qty) => (
                  <button key={qty} onClick={() => setStickerQty(qty)}
                    className="rounded-md px-4 py-2 text-sm font-bold transition-all"
                    style={{ background: stickerQty === qty ? "rgba(255,107,53,0.25)" : "rgba(255,255,255,0.06)", border: stickerQty === qty ? "1.5px solid #ff6b35" : "1px solid rgba(255,255,255,0.1)", color: stickerQty === qty ? "#ff6b35" : "rgba(255,255,255,0.6)" }}>
                    {qty}x
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-md px-4 py-3" style={{ background: "rgba(255,107,53,0.1)", border: "1px solid rgba(255,107,53,0.25)" }}>
                <span className="text-white/60 text-sm">{stickerQty} stickers</span>
                <span className="font-display text-xl font-bold" style={{ color: "#ff6b35" }}>€{stickerPrice.toFixed(2)}</span>
              </div>
            </div>

            <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div className="font-semibold text-white mb-3">Leveringsgegevens</div>
              {[
                { label: "Naam", value: contactName, set: setContactName, placeholder: "Jouw naam" },
                { label: "E-mailadres", value: contactEmail, set: setContactEmail, placeholder: "jouw@email.com" },
                { label: "Adres", value: contactAddress, set: setContactAddress, placeholder: "Straat, stad, land" },
              ].map((f) => (
                <div key={f.label} className="mb-3">
                  <label className="block text-white/50 text-xs uppercase tracking-wider mb-1">{f.label}</label>
                  <input type="text" value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder}
                    className="w-full rounded-md px-3 py-2.5 text-white placeholder-white/25 outline-none text-sm"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>
              ))}
            </div>

            <button onClick={placeOrder} disabled={ordering}
              className="w-full rounded-md py-4 text-lg font-bold text-black transition-all duration-200 active:scale-95 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #ff9a00, #ff3cac)", boxShadow: "0 0 32px rgba(255,154,0,0.4)" }}>
              {ordering ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Bestelling verwerken...
                </span>
              ) : `Bestel ${stickerQty} stickers — €${stickerPrice.toFixed(2)}`}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <div className="flex flex-col items-center py-12 gap-3">
          <span className="inline-block w-8 h-8 border-2 border-white/10 border-t-white/60 rounded-full animate-spin" />
          <p className="text-white/40 text-sm">QR kaartje wordt aangemaakt...</p>
        </div>
      ) : cardDataUrl ? (
        <div className="flex flex-col items-center">
          <img src={cardDataUrl} alt="Cocktailored QR kaartje" className="w-full max-w-xs rounded-xl mb-2" />
          <p className="text-white/30 text-xs mb-5">cocktailored.ai</p>
        </div>
      ) : (
        <div className="text-center py-8 text-white/30 text-sm">Kon QR code niet genereren.</div>
      )}

      <button onClick={downloadPDF} disabled={!cardDataUrl}
        className="w-full rounded-xl p-5 text-left transition-all duration-150 disabled:opacity-40 hover:border-white/20 active:scale-99"
        style={{ background: "rgba(255,154,0,0.08)", border: "1.5px solid rgba(255,154,0,0.3)" }}>
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #ff9a00, #ff3cac)" }}>🖨</div>
          <div>
            <div className="font-bold text-white">Zelf afdrukken</div>
            <p className="text-white/40 text-xs mt-0.5">Download als PDF en print je eigen stickers thuis of bij een printshop.</p>
          </div>
          <span className="text-white/30 ml-auto">→</span>
        </div>
      </button>

      <button onClick={downloadPNG} disabled={!cardDataUrl}
        className="w-full rounded-xl p-5 text-left transition-all duration-150 disabled:opacity-40 hover:border-white/15 active:scale-99"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.1)" }}>📥</div>
          <div>
            <div className="font-bold text-white">Download PNG</div>
            <p className="text-white/40 text-xs mt-0.5">Sla het kaartje op als afbeelding om zelf te gebruiken.</p>
          </div>
          <span className="text-white/30 ml-auto">→</span>
        </div>
      </button>

      <button onClick={() => setView("stickers")}
        className="w-full rounded-xl p-5 text-left transition-all duration-150 hover:border-white/20 active:scale-99"
        style={{ background: "rgba(168,85,247,0.08)", border: "1.5px solid rgba(168,85,247,0.25)" }}>
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}>🏷</div>
          <div>
            <div className="font-bold text-white flex items-center gap-2">
              Stickers bestellen
              <span className="text-xs rounded px-2 py-0.5 font-bold" style={{ background: "rgba(168,85,247,0.25)", color: "#a855f7" }}>NIEUW</span>
            </div>
            <p className="text-white/40 text-xs mt-0.5">Professioneel gedrukt — €10 per 5 stuks, rechtstreeks aan de deur.</p>
          </div>
          <span className="text-white/30 ml-auto">→</span>
        </div>
      </button>
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────────

function BackendStatusCard() {
  // Polls the backend every 20s so the bar can see at a glance whether the
  // site is still linked to its durable database (and not silently running on
  // the ephemeral in-memory fallback, which loses orders on serverless).
  const { data, isLoading, isError, dataUpdatedAt } = trpc.system.status.useQuery(undefined, {
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const ok = data?.ok === true;
  const mode = data?.db.mode;
  const durable = ok && mode === "database";
  const color = isLoading ? "#f59e0b" : durable ? "#10b981" : ok && mode === "memory" ? "#f59e0b" : "#ef4444";
  const label = isLoading
    ? "Verbinding controleren..."
    : isError
      ? "Backend onbereikbaar"
      : durable
        ? "Verbonden met database"
        : mode === "memory"
          ? "Tijdelijke opslag (NIET veilig)"
          : "Database onbereikbaar";
  const sub = isLoading
    ? "Even geduld"
    : durable
      ? `Alles werkt. Reactietijd ${data?.db.latencyMs ?? "?"} ms.`
      : mode === "memory"
        ? "Er is geen DATABASE_URL ingesteld. Bestellingen kunnen verloren gaan. Stel een database in via Vercel."
        : `De database antwoordt niet${data?.db.error ? `: ${data.db.error}` : "."}`;
  const lastChecked = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;

  return (
    <div className="rounded-md p-5" style={{ background: `${color}12`, border: `1.5px solid ${color}45` }}>
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-3 h-3 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
          {durable && <div className="absolute inset-0 w-3 h-3 rounded-full animate-ping" style={{ background: color, opacity: 0.6 }} />}
        </div>
        <div className="min-w-0">
          <div className="text-white font-semibold text-sm">{label}</div>
          <div className="text-white/50 text-xs mt-0.5">{sub}</div>
          {lastChecked && <div className="text-white/25 text-[10px] mt-1">Laatst gecontroleerd om {lastChecked}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Shop tab ─────────────────────────────────────────────────────────────────

const SHOP_ADDRESS_KEY = "bb_shop_address";
// Matches server MARGIN_CENTS — display-only, the server is the source of truth for actual pricing.
const MARGIN_EUR = 0.5;

type ShopAddress = {
  firstName: string; lastName: string; email: string; phone: string;
  country: string; region: string; address1: string; city: string; zip: string;
};

function loadShopAddress(): ShopAddress {
  try {
    const raw = localStorage.getItem(SHOP_ADDRESS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { firstName: "", lastName: "", email: "", phone: "", country: "", region: "", address1: "", city: "", zip: "" };
}

// Same design as the downloadable card in QR Codes — QR + logo, wrapped in
// the full branded card with the "ORDER YOUR PERSONALIZED COCKTAIL" header
// and "Cocktailored" footer — not just the bare QR square. Square corners
// (outerRadius 0) here — Printify's own die-cut shapes the sticker, so
// pre-rounded corners in the source PNG just show up as an unwanted white
// gap inside the actual cut line.
// Same branded card design across every product — QR + logo, wrapped in the
// full card ("ORDER YOUR PERSONALIZED COCKTAIL" header, Cocktailored
// footer) with square corners so each print provider's own die-cut/print
// area defines the shape, not a pre-baked rounded PNG.
async function buildProductArtwork(): Promise<string> {
  const size = 400;
  const styled = renderRoundedQR(QR_URL, size, 0);
  const logoImg = await loadImage("/brand/cocktail-logo.jpeg");
  drawCenterLogo(styled, logoImg);
  const card = buildCardCanvas(styled, 0);
  return card.toDataURL("image/png");
}

const SHOP_PRODUCT_DEFS: Array<{ key: string; label: string; emoji: string }> = [
  { key: "sticker", label: "QR Sticker", emoji: "🏷️" },
  { key: "sticker_roll", label: "Stickerrol", emoji: "🧻" },
  { key: "beer_mug", label: "Bierglas", emoji: "🍺" },
  { key: "coaster", label: "Onderzetter", emoji: "🥌" },
];

// A product-page-style image carousel — one photo at a time, prev/next
// arrows, dot indicators — the way a real webshop shows product photos
// instead of a flat grid of thumbnails.
function ImageCarousel({ images }: { images: Array<{ src: string }> }) {
  const [idx, setIdx] = useState(0);
  if (images.length === 0) return null;
  const i = Math.min(idx, images.length - 1);
  return (
    <div className="relative">
      <img src={images[i].src} alt="" className="w-full aspect-square object-cover rounded-md"
        style={{ background: "#fff", border: "1px solid rgba(255,255,255,0.1)" }} />
      {images.length > 1 && (
        <>
          <button onClick={() => setIdx((v) => (v - 1 + images.length) % images.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-white text-sm"
            style={{ background: "rgba(0,0,0,0.55)" }}>‹</button>
          <button onClick={() => setIdx((v) => (v + 1) % images.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-white text-sm"
            style={{ background: "rgba(0,0,0,0.55)" }}>›</button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, dotIdx) => (
              <div key={dotIdx} className="w-1.5 h-1.5 rounded-full transition-all"
                style={{ background: dotIdx === i ? "#ff6b35" : "rgba(255,255,255,0.4)" }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// One self-contained "webshop tile" per product: its own preview carousel,
// size picker, quantity, and order form — same shape a real product page
// on a webshop would have, just for a physical print-on-demand product.
function ProductCard({ productKey, label, emoji, productId }: {
  productKey: string; label: string; emoji: string; productId: string | null;
}) {
  const utils = trpc.useUtils();
  const { data: product, refetch: refetchProduct } = trpc.admin.shop.getProduct.useQuery(
    { productKey }, { enabled: !!productId }
  );
  const [settingUp, setSettingUp] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(50);
  const [address, setAddress] = useState<ShopAddress>(() => loadShopAddress());
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [shippingCents, setShippingCents] = useState<number | null>(null);
  const [checkingShipping, setCheckingShipping] = useState(false);

  const setupMutation = trpc.admin.shop.setupProduct.useMutation({
    onSuccess: () => { toast.success(`${label} aangemaakt in Printify!`); utils.admin.shop.status.invalidate(); refetchProduct(); },
    onError: (err: { message: string }) => toast.error(`Kon product niet aanmaken: ${err.message}`),
    onSettled: () => setSettingUp(false),
  });

  const orderMutation = trpc.admin.shop.orderProduct.useMutation({
    onSuccess: () => { toast.success("Bestelling geplaatst bij Printify!"); setShowOrderForm(false); },
    onError: (err: { message: string }) => toast.error(`Bestelling mislukt: ${err.message}`),
  });

  const handleSetup = async () => {
    setSettingUp(true);
    try {
      const imageBase64 = await buildProductArtwork();
      setupMutation.mutate({ productKey, imageBase64 });
    } catch {
      toast.error("Kon de afbeelding niet genereren.");
      setSettingUp(false);
    }
  };

  const enabledVariants = (product?.variants ?? []).filter((v: { is_enabled: boolean }) => v.is_enabled);
  const activeVariantId = selectedVariantId ?? enabledVariants[0]?.id ?? null;
  const mockups = product?.images.filter((img: { variant_ids: number[] }) =>
    !activeVariantId || img.variant_ids.includes(activeVariantId)) ?? [];
  const startPrice = enabledVariants.length > 0
    ? Math.min(...enabledVariants.map((v: { price: number }) => v.price)) / 100
    : null;

  const activeVariant = enabledVariants.find((v: { id: number }) => v.id === activeVariantId);
  const unitPrice = activeVariant ? activeVariant.price / 100 : null;
  const totalCents = unitPrice !== null ? Math.round(unitPrice * 100) * quantity + (shippingCents ?? 0) : null;

  const handleCheckShipping = async () => {
    if (!activeVariantId) return;
    setCheckingShipping(true);
    setShippingCents(null);
    try {
      const result = await utils.client.admin.shop.getShippingCost.query({ productKey, variantId: activeVariantId, quantity, addressTo: address });
      const cheapest = Math.min(...Object.values(result).filter((v): v is number => typeof v === "number"));
      setShippingCents(Number.isFinite(cheapest) ? cheapest : null);
    } catch {
      toast.error("Kon verzendkosten niet berekenen — controleer het adres.");
    } finally {
      setCheckingShipping(false);
    }
  };

  // Required delivery-address fields — a location is mandatory before a real
  // order (and real charge) can go out. Region is the only optional field
  // (many countries don't use states/provinces), matching the server schema.
  const addressComplete = !!(
    address.firstName.trim() && address.lastName.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email) &&
    address.phone.trim() && address.address1.trim() &&
    address.city.trim() && address.zip.trim() && address.country.trim()
  );

  const handleOrderSubmit = () => {
    if (!activeVariantId) return;
    if (!addressComplete) {
      toast.error("Vul eerst een volledig bezorgadres in (naam, e-mail, telefoon, adres, stad, postcode, land).");
      return;
    }
    localStorage.setItem(SHOP_ADDRESS_KEY, JSON.stringify(address));
    const totalLabel = totalCents !== null ? ` (totaal €${(totalCents / 100).toFixed(2)}${shippingCents === null ? " excl. verzending" : ""})` : "";
    if (!window.confirm(`Dit plaatst een ECHTE bestelling bij Printify voor ${quantity}x ${label}${totalLabel} en belast jouw betaalmethode. Doorgaan?`)) return;
    orderMutation.mutate({ productKey, variantId: activeVariantId, quantity, addressTo: address });
  };

  return (
    <div className="rounded-md overflow-hidden flex flex-col" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">{emoji}</span>
            <div className="text-white font-semibold text-sm">{label}</div>
          </div>
          {startPrice !== null && <div className="text-white/40 text-xs">v.a. €{startPrice.toFixed(2)}</div>}
        </div>

        {!productId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <p className="text-white/40 text-xs mb-3">Nog niet opgezet in Printify.</p>
            <button onClick={handleSetup} disabled={settingUp}
              className="rounded-md px-4 py-2 font-bold text-black text-xs disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>
              {settingUp ? "Bezig..." : "Opzetten"}
            </button>
          </div>
        ) : (
          <>
            {mockups.length > 0
              ? <ImageCarousel images={mockups} />
              : <p className="text-white/40 text-xs py-8 text-center">Previews laden...</p>}
            <button onClick={handleSetup} disabled={settingUp}
              className="text-[11px] text-white/40 hover:text-white/70 underline transition-colors mt-2 self-start">
              {settingUp ? "Bezig..." : "Ontwerp vernieuwen"}
            </button>

            {enabledVariants.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {enabledVariants.map((v: { id: number; title: string; price: number }) => (
                  <button key={v.id} onClick={() => { setSelectedVariantId(v.id); setShippingCents(null); }}
                    className="rounded-md px-2 py-1 text-[11px] font-medium transition-all"
                    style={{
                      background: activeVariantId === v.id ? "rgba(255,107,53,0.15)" : "rgba(255,255,255,0.05)",
                      border: activeVariantId === v.id ? "1px solid rgba(255,107,53,0.35)" : "1px solid rgba(255,255,255,0.1)",
                      color: activeVariantId === v.id ? "#ff6b35" : "rgba(255,255,255,0.6)",
                    }}>
                    {v.title} · €{(v.price / 100).toFixed(2)}
                  </button>
                ))}
              </div>
            )}
            {unitPrice !== null && (
              <p className="text-white/40 text-[11px] mt-1.5">
                €{unitPrice.toFixed(2)}/stuk × {quantity} = €{((unitPrice * quantity)).toFixed(2)} (incl. €{(MARGIN_EUR).toFixed(2)} marge per stuk, excl. verzending)
              </p>
            )}

            {!showOrderForm ? (
              <div className="flex items-end gap-2 mt-3">
                <div style={{ maxWidth: "90px" }}>
                  <label className="block text-white/40 text-[10px] uppercase tracking-wider mb-1">Aantal</label>
                  <input type="number" min={1} max={1000} value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full rounded-md px-2.5 py-2 text-white outline-none text-sm"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>
                <button onClick={() => setShowOrderForm(true)} disabled={!activeVariantId}
                  className="flex-1 rounded-md py-2.5 font-bold text-black text-xs disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #10b981, #22d3ee)" }}>
                  Bestellen →
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-md p-3" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
                <div className="text-white font-semibold text-xs mb-2">Bezorgadres</div>
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  <input placeholder="Voornaam" value={address.firstName} onChange={(e) => setAddress({ ...address, firstName: e.target.value })}
                    className="rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <input placeholder="Achternaam" value={address.lastName} onChange={(e) => setAddress({ ...address, lastName: e.target.value })}
                    className="rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>
                <input placeholder="E-mailadres" value={address.email} onChange={(e) => setAddress({ ...address, email: e.target.value })}
                  className="w-full rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs mb-1.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                <input placeholder="Telefoonnummer" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                  className="w-full rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs mb-1.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                <input placeholder="Adres" value={address.address1} onChange={(e) => setAddress({ ...address, address1: e.target.value })}
                  className="w-full rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs mb-1.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  <input placeholder="Stad" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    className="rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <input placeholder="Postcode" value={address.zip} onChange={(e) => setAddress({ ...address, zip: e.target.value })}
                    className="rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  <input placeholder="Provincie/regio" value={address.region} onChange={(e) => setAddress({ ...address, region: e.target.value })}
                    className="rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                  <input placeholder="Landcode (bv. ID, US)" value={address.country} onChange={(e) => { setAddress({ ...address, country: e.target.value }); setShippingCents(null); }}
                    className="rounded-md px-2.5 py-1.5 text-white placeholder-white/30 outline-none text-xs" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>

                <button onClick={handleCheckShipping} disabled={checkingShipping}
                  className="text-[11px] text-white/50 hover:text-white/80 underline transition-colors disabled:opacity-50 mb-2">
                  {checkingShipping ? "Verzendkosten berekenen..." : "Bereken verzendkosten"}
                </button>
                {shippingCents !== null && (
                  <p className="text-white/50 text-[11px] mb-2">Verzending: €{(shippingCents / 100).toFixed(2)}</p>
                )}
                {totalCents !== null && (
                  <p className="text-white font-semibold text-xs mb-2">
                    Totaal: €{(totalCents / 100).toFixed(2)}{shippingCents === null && <span className="text-white/40 font-normal"> (excl. verzending)</span>}
                  </p>
                )}

                {!addressComplete && (
                  <p className="text-amber-400 text-[11px] mb-2">Vul een volledig bezorgadres in om te kunnen bestellen.</p>
                )}
                <div className="flex gap-2">
                  <button onClick={handleOrderSubmit} disabled={orderMutation.isPending || !addressComplete}
                    className="rounded-md px-3 py-2 font-bold text-black text-xs disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #10b981, #22d3ee)" }}>
                    {orderMutation.isPending ? "Bezig..." : `Bevestig (${quantity}x)`}
                  </button>
                  <button onClick={() => setShowOrderForm(false)} className="text-white/40 hover:text-white/70 text-xs transition-colors px-2">
                    Annuleren
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ShopTab() {
  const { data: status } = trpc.admin.shop.status.useQuery();

  if (!status?.configured) {
    return (
      <div className="rounded-md p-5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
        <div className="text-white font-semibold mb-1">Printify is niet ingesteld</div>
        <p className="text-white/50 text-sm">Voeg <code className="text-white/70">PRINTIFY_API_TOKEN</code> toe aan de environment variables in Vercel om deze tab te gebruiken.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {SHOP_PRODUCT_DEFS.map((def) => (
        <ProductCard key={def.key} productKey={def.key} label={def.label} emoji={def.emoji}
          productId={status.products[def.key] ?? null} />
      ))}
    </div>
  );
}

function SettingsTab() {
  const { data: settings, refetch } = trpc.admin.getSettings.useQuery();
  const updateMutation = trpc.admin.updateSetting.useMutation({
    onSuccess: () => { refetch(); toast.success("Opgeslagen!"); },
  });
  const utils = trpc.useUtils();
  const clearOrdersMutation = trpc.admin.clearAllOrders.useMutation({
    onSuccess: () => { utils.admin.getSessions.invalidate(); toast.success("Alle bestellingen zijn verwijderd."); },
    onError: () => toast.error("Er ging iets mis bij het verwijderen."),
  });
  const [whatsapp, setWhatsapp] = useState("");
  useEffect(() => {
    if (settings) {
      const wa = settings.find((s) => s.key === "whatsapp_number");
      if (wa?.value) setWhatsapp(wa.value);
    }
  }, [settings]);

  const tableNumberEnabled = settings?.find((s) => s.key === "table_number_enabled")?.value === "true";

  return (
    <div className="flex flex-col gap-4">
      <BackendStatusCard />
      <div className="rounded-md p-5 flex items-center justify-between gap-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div>
          <div className="text-white font-semibold mb-1">Tafelnummer vragen</div>
          <p className="text-white/40 text-xs">Vraag de gast om een tafelnummer, direct onder de naam in de quiz.</p>
        </div>
        <IngredientToggle available={tableNumberEnabled}
          onChange={() => updateMutation.mutate({ key: "table_number_enabled", value: tableNumberEnabled ? "false" : "true" })} />
      </div>
      <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="text-white font-semibold mb-1">WhatsApp Nummer</div>
        <p className="text-white/40 text-xs mb-3">Nummer van de barman voor bestellingsmeldingen.</p>
        <input type="text" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
          className="w-full rounded-md px-3 py-2.5 text-white placeholder-white/30 outline-none mb-3 text-sm"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }} placeholder="+32..." />
        <button onClick={() => updateMutation.mutate({ key: "whatsapp_number", value: whatsapp })}
          disabled={updateMutation.isPending}
          className="rounded-md px-4 py-2 font-bold text-black text-sm disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #a855f7, #22d3ee)" }}>
          {updateMutation.isPending ? "Opslaan..." : "Opslaan"}
        </button>
      </div>
      <div className="rounded-md p-5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
        <div className="text-white font-semibold mb-1">Alle bestellingen verwijderen</div>
        <p className="text-white/40 text-xs mb-3">Verwijdert alle bestellingen uit Bestellingen. Quizantwoorden en recepten blijven bewaard.</p>
        <button
          onClick={() => {
            if (window.confirm("Weet je zeker dat je ALLE bestellingen wilt verwijderen? Dit kan niet ongedaan worden gemaakt.")) {
              clearOrdersMutation.mutate();
            }
          }}
          disabled={clearOrdersMutation.isPending}
          className="rounded-md px-4 py-2 font-bold text-white text-sm disabled:opacity-50"
          style={{ background: "rgba(239,68,68,0.8)" }}>
          {clearOrdersMutation.isPending ? "Bezig..." : "Verwijder alle bestellingen"}
        </button>
      </div>
      <div className="rounded-md p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="text-white font-semibold mb-2">Systeeminformatie</div>
        <div className="text-white/40 text-xs space-y-1">
          <p>Bar: The Beast Bar, Indonesië</p>
          <p>Smaakmodel: 15-principe psychologie</p>
          <p>Maten: milliliters</p>
        </div>
      </div>
    </div>
  );
}

// ── Admin shell ───────────────────────────────────────────────────────────────

export default function Admin() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("orders");
  const logoutMutation = trpc.admin.logout.useMutation({ onSuccess: () => setIsLoggedIn(false) });
  const { data: authData } = trpc.admin.checkAuth.useQuery();
  useEffect(() => { if (authData?.authenticated) setIsLoggedIn(true); }, [authData]);

  if (!isLoggedIn) return <LoginPage onLogin={() => setIsLoggedIn(true)} />;

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: "ingredients", label: "Ingrediënten", icon: "🍹" },
    { id: "orders", label: "Bestellingen", icon: "📋" },
    { id: "qrcodes", label: "QR Codes", icon: "⬛" },
    { id: "shop", label: "Shop", icon: "🛒" },
    { id: "settings", label: "Instellingen", icon: "⚙️" },
  ];

  const tabDesc: Record<AdminTab, string> = {
    ingredients: "Schakel in/uit wat op voorraad is. Claude gebruikt alleen beschikbare ingrediënten.",
    orders: "Alle bestellingen en gegenereerde cocktails.",
    qrcodes: "Genereer en download QR codes voor jouw bar.",
    shop: "Bestel fysieke producten met jouw QR-ontwerp, geleverd via Printify.",
    settings: "Meldingsinstellingen.",
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-screen overflow-hidden">
        <aside className="hidden sm:flex flex-col w-56 flex-shrink-0 border-r border-white/8" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="px-5 py-5 border-b border-white/8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md flex items-center justify-center text-lg" style={{ background: "linear-gradient(135deg, #ff6b35, #f59e0b)" }}>🍹</div>
              <div>
                <div className="font-display text-sm font-bold text-white">Beast Bar</div>
                <div className="text-white/40 text-xs">Beheer</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 text-left"
                style={{ background: activeTab === tab.id ? "rgba(255,107,53,0.15)" : "transparent", color: activeTab === tab.id ? "#ff6b35" : "rgba(255,255,255,0.5)", border: activeTab === tab.id ? "1px solid rgba(255,107,53,0.3)" : "1px solid transparent" }}>
                <span>{tab.icon}</span>{tab.label}
              </button>
            ))}
          </nav>
          <div className="px-3 py-4 border-t border-white/8">
            <button onClick={() => logoutMutation.mutate()}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-white/40 hover:text-white/70 transition-colors"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <span>🚪</span> Uitloggen
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="sm:hidden sticky top-0 z-20 px-4 py-3 flex items-center justify-between"
            style={{ background: "rgba(9,9,20,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="font-display text-lg font-bold text-white">Beast Bar Admin</div>
            <button onClick={() => logoutMutation.mutate()} className="rounded-md px-3 py-1.5 text-xs text-white/50 hover:text-white transition-colors" style={{ background: "rgba(255,255,255,0.06)" }}>
              Uitloggen
            </button>
          </div>

          <div className="sm:hidden px-4 py-2 border-b border-white/8" style={{ background: "rgba(9,9,20,0.9)" }}>
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="flex-1 flex items-center justify-center gap-1 rounded-md py-2 text-xs font-semibold transition-all duration-150"
                  style={{ background: activeTab === tab.id ? "rgba(255,107,53,0.2)" : "transparent", color: activeTab === tab.id ? "#ff6b35" : "rgba(255,255,255,0.4)" }}>
                  <span>{tab.icon}</span>
                  <span className="hidden xs:inline">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="hidden sm:block px-6 py-5 border-b border-white/8">
            <h2 className="font-display text-2xl font-bold text-white">{tabs.find((t) => t.id === activeTab)?.label}</h2>
            <p className="text-white/40 text-sm mt-0.5">{tabDesc[activeTab]}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-16">
            {activeTab === "ingredients" && <IngredientsTab />}
            {activeTab === "orders" && <OrdersTab />}
            {activeTab === "qrcodes" && <QRCodesTab />}
            {activeTab === "shop" && <ShopTab />}
            {activeTab === "settings" && <SettingsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
