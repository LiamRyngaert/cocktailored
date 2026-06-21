import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import * as THREE from "three";

// Real people photo URLs (Unsplash — more women than men)
const REVIEW_PHOTOS: Record<string, string> = {
  "Maya S.": "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=80&h=80&fit=crop&crop=face",
  "Lena V.": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face",
  "Sophie K.": "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=face",
  "Nadia R.": "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=80&h=80&fit=crop&crop=face",
  "Zara M.": "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=80&h=80&fit=crop&crop=face",
  "Tomas B.": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face",
  "Isla P.": "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=80&h=80&fit=crop&crop=face",
  "Roos D.": "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=80&h=80&fit=crop&crop=face",
};

/**
 * Full-page Three.js blob canvas that covers the ENTIRE document height.
 * Blobs drift freely across the whole scroll — no section cuts.
 */
function FullPageBlobCanvas({ pageHeight }: { pageHeight: number }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || pageHeight < 100) return;

    const w = window.innerWidth;
    const h = pageHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 200);
    camera.position.z = 12;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // Blobs spread across the full vertical extent of the page
    // y values go from +12 (top) down to -34 (bottom of long page)
    const blobDefs = [
      { color: "#ff6b35", r: 1.5, x: -5,  y:  12, z: -2 },
      { color: "#a855f7", r: 1.9, x:  6,  y:   7, z: -3 },
      { color: "#22d3ee", r: 1.2, x: -3,  y:   2, z: -1 },
      { color: "#f59e0b", r: 1.6, x:  5,  y:  -3, z: -2 },
      { color: "#ec4899", r: 1.3, x: -7,  y:  -8, z: -1 },
      { color: "#10b981", r: 1.7, x:  3,  y: -13, z: -3 },
      { color: "#6366f1", r: 1.1, x: -2,  y: -18, z: -2 },
      { color: "#ff6b35", r: 1.4, x:  7,  y: -23, z: -1 },
      { color: "#a855f7", r: 1.8, x: -5,  y: -28, z: -3 },
      { color: "#22d3ee", r: 1.0, x:  2,  y: -33, z: -2 },
      { color: "#ec4899", r: 1.5, x: -8,  y: -38, z: -1 },
      { color: "#f59e0b", r: 1.2, x:  6,  y: -43, z: -2 },
    ];

    const blobs: { mesh: THREE.Mesh; ox: number; oy: number; phase: number; speed: number }[] = [];

    for (const def of blobDefs) {
      const geo = new THREE.SphereGeometry(def.r, 40, 40);
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(def.color),
        transparent: true,
        opacity: 0.5,
        roughness: 0.05,
        metalness: 0.05,
        transmission: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(def.x, def.y, def.z);
      scene.add(mesh);
      blobs.push({
        mesh,
        ox: def.x,
        oy: def.y,
        phase: Math.random() * Math.PI * 2,
        speed: 0.18 + Math.random() * 0.12,
      });
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const pl1 = new THREE.PointLight(0xff6b35, 3, 50);
    pl1.position.set(4, 4, 8);
    scene.add(pl1);
    const pl2 = new THREE.PointLight(0xa855f7, 2, 50);
    pl2.position.set(-4, -10, 8);
    scene.add(pl2);

    let animating = true;
    function animate() {
      if (!animating) return;
      requestAnimationFrame(animate);
      const t = performance.now() / 1000;
      blobs.forEach(({ mesh, ox, oy, phase, speed }, i) => {
        mesh.position.x = ox + Math.sin(t * speed + phase) * 2.0;
        mesh.position.y = oy + Math.cos(t * speed * 0.7 + phase) * 1.4;
        const s = 1 + Math.sin(t * 1.2 + i * 0.6) * 0.08;
        mesh.scale.set(s, 1 / s, s);
        mesh.rotation.y += 0.003;
      });
      pl1.position.x = Math.sin(t * 0.3) * 7;
      pl1.position.z = Math.cos(t * 0.3) * 7;
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      animating = false;
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [pageHeight]);

  return (
    <div
      ref={mountRef}
      className="absolute top-0 left-0 w-full pointer-events-none"
      style={{ height: pageHeight, zIndex: 0 }}
    />
  );
}

function ReviewCard({ review }: { review: { name: string; text: string; rating: number; color: string } }) {
  const photoUrl = REVIEW_PHOTOS[review.name];
  return (
    <div
      className="p-5 flex flex-col gap-3 flex-shrink-0 w-72 sm:w-80"
      style={{
        background: `linear-gradient(135deg, ${review.color}18, rgba(255,255,255,0.025))`,
        border: `1.5px solid ${review.color}30`,
        borderRadius: "8px",
      }}
    >
      <div className="flex items-center gap-3">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={review.name}
            className="w-11 h-11 object-cover flex-shrink-0"
            style={{ borderRadius: "50%", border: `2px solid ${review.color}50` }}
            onError={(e) => {
              const t = e.currentTarget as HTMLImageElement;
              t.style.display = "none";
              const fb = t.nextElementSibling as HTMLElement;
              if (fb) fb.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="w-11 h-11 items-center justify-center text-base font-bold flex-shrink-0"
          style={{ background: review.color, borderRadius: "50%", display: photoUrl ? "none" : "flex" }}
        >
          {review.name[0]}
        </div>
        <div>
          <div className="font-bold text-white text-sm">{review.name}</div>
          <div className="flex gap-0.5">
            {Array.from({ length: review.rating }).map((_, i) => (
              <span key={i} className="text-yellow-400 text-xs">★</span>
            ))}
          </div>
        </div>
      </div>
      <p className="text-white/75 text-sm leading-relaxed">{review.text}</p>
    </div>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: reviews } = trpc.public.getReviews.useQuery();
  const pageRef = useRef<HTMLDivElement>(null);
  const [pageHeight, setPageHeight] = useState(3200);

  // Measure full page height so the blob canvas covers it all
  useEffect(() => {
    const measure = () => {
      if (pageRef.current) {
        setPageHeight(pageRef.current.scrollHeight);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (pageRef.current) ro.observe(pageRef.current);
    return () => ro.disconnect();
  }, [reviews]);

  return (
    <div ref={pageRef} className="relative bg-background overflow-x-hidden">
      {/* Single full-page blob canvas — covers the entire scroll height */}
      <FullPageBlobCanvas pageHeight={pageHeight} />

      {/* Subtle dark veil so text stays readable without killing the blobs */}
      <div
        className="absolute top-0 left-0 w-full pointer-events-none"
        style={{ height: pageHeight, background: "rgba(8,8,20,0.52)", zIndex: 1 }}
      />

      {/* All content sits above the blob canvas */}
      <div className="relative" style={{ zIndex: 2 }}>

        {/* ── HERO ── */}
        <div className="flex flex-col items-center justify-center text-center px-5 pt-28 pb-24 min-h-screen">
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-white leading-tight mb-5">
            Your cocktail,{" "}
            <span className="beast-text-gradient">made for you.</span>
          </h1>
          <p className="text-white/65 text-lg sm:text-xl mb-10 max-w-lg mx-auto leading-relaxed">
            Answer 10 fun questions. Get 3 cocktails designed around your personality, your mood, and your flavour psychology. Then we make it right at the bar.
          </p>
          <button
            onClick={() => setLocation("/quiz")}
            className="inline-flex items-center gap-3 px-9 py-4 text-xl font-bold text-black transition-all duration-200 active:scale-95 pulse-glow"
            style={{
              background: "linear-gradient(135deg, #ff6b35, #f59e0b)",
              boxShadow: "0 0 48px rgba(255,107,53,0.55)",
              borderRadius: "8px",
            }}
          >
            <span className="text-2xl">🍹</span>
            Find My Cocktail
            <span className="text-xl">→</span>
          </button>
          <p className="text-white/35 text-sm mt-4">Takes about 2 minutes. Free to try.</p>

          {/* Scroll hint */}
          <div className="mt-16 flex flex-col items-center gap-2 text-white/30">
            <span className="text-xs tracking-widest uppercase">scroll</span>
            <div
              className="w-5 h-8 flex items-start justify-center pt-1.5"
              style={{ border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px" }}
            >
              <div className="w-1 h-2 bg-white/35 animate-bounce" style={{ borderRadius: "2px" }} />
            </div>
          </div>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="px-5 py-20 max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-3">How it works</h2>
            <p className="text-white/50 text-lg">Three steps to your perfect drink.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step: "01", emoji: "🧠", title: "Take the quiz", desc: "10 fun questions about your personality, mood, and flavor vibes." },
              { step: "02", emoji: "✨", title: "We read your mind", desc: "Flavor psychology turns your answers into a precise cocktail profile." },
              { step: "03", emoji: "🍸", title: "Get your cocktail", desc: "3 personalised recipes, made from what we have at the bar, right now." },
            ].map((item) => (
              <div
                key={item.step}
                className="p-6 text-center flex flex-col items-center gap-3"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                }}
              >
                <div className="text-4xl">{item.emoji}</div>
                <div className="font-display text-4xl font-bold beast-text-gradient">{item.step}</div>
                <h3 className="font-display text-xl font-bold text-white">{item.title}</h3>
                <p className="text-white/55 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── REVIEWS ── */}
        <div className="py-20">
          <div className="text-center mb-10 px-5">
            <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-3">People are obsessed</h2>
            <p className="text-white/50 text-lg">Real drinks, real reactions.</p>
          </div>
          <div className="overflow-x-auto pb-4 px-5">
            <div className="flex gap-4 w-max">
              {(reviews ?? []).map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mt-8 px-5">
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="text-yellow-400 text-2xl">★</span>
              ))}
            </div>
            <span className="text-white font-bold text-lg">5.0</span>
            <span className="text-white/45">from 200+ cocktails served</span>
          </div>
        </div>

        {/* ── FINAL CTA ── */}
        <div className="px-5 py-28 text-center max-w-xl mx-auto">
          <div className="text-6xl mb-6 float-anim">🍹</div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-4">
            Ready to meet your cocktail?
          </h2>
          <p className="text-white/55 text-lg mb-10">
            The bartender is waiting. Your flavor profile is one quiz away.
          </p>
          <button
            onClick={() => setLocation("/quiz")}
            className="inline-flex items-center gap-3 px-9 py-4 text-xl font-bold text-black transition-all duration-200 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #a855f7, #22d3ee)",
              boxShadow: "0 0 48px rgba(168,85,247,0.5)",
              borderRadius: "8px",
            }}
          >
            <span className="text-2xl">🎯</span>
            Start the Quiz
          </button>
        </div>

        {/* ── FOOTER ── */}
        <footer
          className="py-8 px-5 text-center text-white/25 text-sm"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="font-display text-base font-bold text-white/40 mb-1">The Beast Bar</p>
          <p>Indonesia &bull; Cocktails made personal</p>
        </footer>
      </div>
    </div>
  );
}
