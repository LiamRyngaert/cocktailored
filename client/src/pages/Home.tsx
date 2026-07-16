import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import * as THREE from "three";

const FALLBACK_REVIEWS = [
  { id: 1, name: "Sofia M.", text: "Ik kreeg een pittige passievrucht margarita en dat was precies wat ik nodig had. Dat had ik nooit zelf besteld!", rating: 5, color: "#ff6b35" },
  { id: 2, name: "Emma V.", text: "De quiz duurde 2 minuten en mijn cocktail was gewoon perfect. De barman was ook onder de indruk van het recept.", rating: 5, color: "#a855f7" },
  { id: 3, name: "Lena K.", text: "Ik kreeg een lavendel gin fizz. Ik ben normaal geen gin-persoon, maar dit heeft me volledig omgedraaid.", rating: 5, color: "#22d3ee" },
  { id: 4, name: "Nathalie B.", text: "Mijn vrienden en ik deden het samen en kregen allemaal andere cocktails. Ze waren allemaal raak.", rating: 5, color: "#f59e0b" },
  { id: 5, name: "Yasmine R.", text: "Echt leuke ervaring. De cocktail paste perfect bij mijn vibe. Dit doe ik elke keer dat ik hier kom.", rating: 4, color: "#ec4899" },
  { id: 6, name: "Amelie D.", text: "Ik bestel altijd hetzelfde. Dit zette me ertoe om iets nieuws te proberen en het was het beste drankje dat ik in jaren heb gehad.", rating: 5, color: "#10b981" },
  { id: 7, name: "Thomas W.", text: "Was eerst sceptisch maar de kokos rum smash was ongelooflijk. Echt een aanrader.", rating: 5, color: "#6366f1" },
  { id: 8, name: "Julien P.", text: "Kreeg een rokerige mezcal sour. Schijnbaar exact mijn persoonlijkheid. Geweldig.", rating: 4, color: "#f97316" },
];

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
      { color: "#ff6b35", r: 2.2, x: -5,  y:  12, z: -2 },
      { color: "#a855f7", r: 2.8, x:  6,  y:   7, z: -3 },
      { color: "#22d3ee", r: 1.8, x: -3,  y:   2, z: -1 },
      { color: "#f59e0b", r: 2.4, x:  5,  y:  -3, z: -2 },
      { color: "#ec4899", r: 2.0, x: -7,  y:  -8, z: -1 },
      { color: "#10b981", r: 2.5, x:  3,  y: -13, z: -3 },
      { color: "#6366f1", r: 1.7, x: -2,  y: -18, z: -2 },
      { color: "#ff6b35", r: 2.1, x:  7,  y: -23, z: -1 },
      { color: "#a855f7", r: 2.6, x: -5,  y: -28, z: -3 },
      { color: "#22d3ee", r: 1.6, x:  2,  y: -33, z: -2 },
      { color: "#ec4899", r: 2.2, x: -8,  y: -38, z: -1 },
      { color: "#f59e0b", r: 1.9, x:  6,  y: -43, z: -2 },
    ];

    const blobs: { mesh: THREE.Mesh; ox: number; oy: number; phase: number; speed: number }[] = [];

    for (const def of blobDefs) {
      const geo = new THREE.SphereGeometry(def.r, 40, 40);
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(def.color),
        transparent: true,
        opacity: 0.85,
        roughness: 0.0,
        metalness: 0.1,
        emissive: new THREE.Color(def.color),
        emissiveIntensity: 0.35,
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

    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const pl1 = new THREE.PointLight(0xff6b35, 6, 60);
    pl1.position.set(4, 4, 8);
    scene.add(pl1);
    const pl2 = new THREE.PointLight(0xa855f7, 4, 60);
    pl2.position.set(-4, -10, 8);
    scene.add(pl2);
    const pl3 = new THREE.PointLight(0x22d3ee, 3, 60);
    pl3.position.set(0, 0, 10);
    scene.add(pl3);

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

function ReviewCard({ review }: { review: { name: string; text: string; rating: number; color?: string } }) {
  const color = review.color ?? "#ff6b35";
  return (
    <div
      className="p-5 flex flex-col gap-3 flex-shrink-0 w-72 sm:w-80"
      style={{
        background: `linear-gradient(135deg, ${color}18, rgba(255,255,255,0.025))`,
        border: `1.5px solid ${color}30`,
        borderRadius: "8px",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 flex items-center justify-center text-base font-bold flex-shrink-0 text-white"
          style={{ background: color, borderRadius: "50%" }}
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
  // Prefetch the quiz config (e.g. whether to ask for a table number) while the
  // guest is still on the home page, so it's already resolved by the time they
  // tap into the quiz — instead of popping in late after a Hetzner round trip.
  trpc.quiz.getConfig.useQuery();
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
        style={{ height: pageHeight, background: "rgba(8,8,20,0.12)", zIndex: 1 }}
      />

      {/* All content sits above the blob canvas */}
      <div className="relative" style={{ zIndex: 2 }}>

        {/* ── HERO ── */}
        <div className="flex flex-col items-center justify-center text-center px-5 pt-28 pb-24 min-h-screen">
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold text-white leading-tight mb-5">
            Jouw cocktail,{" "}
            <span className="beast-text-gradient">gemaakt voor jou.</span>
          </h1>
          <p className="text-white/65 text-lg sm:text-xl mb-10 max-w-lg mx-auto leading-relaxed">
            Beantwoord 10 leuke vragen. Krijg 3 cocktails ontworpen rondom jouw persoonlijkheid, stemming en smaakpsychologie. We maken het meteen aan de bar.
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
            Vind Mijn Cocktail
            <span className="text-xl">→</span>
          </button>
          <p className="text-white/35 text-sm mt-4">Duurt ongeveer 2 minuten. Gratis te proberen.</p>

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
            <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-3">Hoe het werkt</h2>
            <p className="text-white/50 text-lg">Drie stappen naar jouw perfecte drankje.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step: "01", emoji: "🧠", title: "Doe de quiz", desc: "10 leuke vragen over jouw persoonlijkheid, stemming en smaak." },
              { step: "02", emoji: "✨", title: "We lezen je gedachten", desc: "Smaakpsychologie zet jouw antwoorden om in een cocktailprofiel op maat." },
              { step: "03", emoji: "🍸", title: "Krijg jouw cocktail", desc: "3 gepersonaliseerde recepten, gemaakt van wat we op dit moment aan de bar hebben." },
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
            <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-3">Iedereen is er gek op</h2>
            <p className="text-white/50 text-lg">Echte drankjes, echte reacties.</p>
          </div>
          <div className="overflow-x-auto pb-4 px-5">
            <div className="flex gap-4 w-max">
              {(reviews && reviews.length > 0 ? reviews : FALLBACK_REVIEWS).map((review) => (
                <ReviewCard key={review.id} review={review as { name: string; text: string; rating: number; color: string }} />
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
            <span className="text-white/45">van 200+ cocktails geserveerd</span>
          </div>
        </div>

        {/* ── FINAL CTA ── */}
        <div className="px-5 py-28 text-center max-w-xl mx-auto">
          <div className="text-6xl mb-6 float-anim">🍹</div>
          <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-4">
            Klaar om jouw cocktail te ontmoeten?
          </h2>
          <p className="text-white/55 text-lg mb-10">
            De barman wacht. Jouw smaakprofiel is één quiz verwijderd.
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
            Start de Quiz
          </button>
        </div>

        {/* ── FOOTER ── */}
        <footer
          className="py-8 px-5 text-center text-white/25 text-sm"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="font-display text-base font-bold text-white/40 mb-1">The Beast Bar</p>
          <p>Indonesië &bull; Cocktails op maat</p>
        </footer>
      </div>
    </div>
  );
}
