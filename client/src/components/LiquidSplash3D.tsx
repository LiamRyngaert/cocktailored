import { useEffect, useRef } from "react";
import * as THREE from "three";

interface LiquidSplash3DProps {
  color?: string;
  secondaryColor?: string;
  className?: string;
  height?: number;
  particleCount?: number;
  autoAnimate?: boolean;
}

export default function LiquidSplash3D({
  color = "#ff6b35",
  secondaryColor = "#a855f7",
  className = "",
  height = 300,
  autoAnimate = true,
}: LiquidSplash3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 400;
    const h = height;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.set(0, 0, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const pointLight1 = new THREE.PointLight(new THREE.Color(color), 3, 20);
    pointLight1.position.set(3, 3, 3);
    scene.add(pointLight1);
    const pointLight2 = new THREE.PointLight(new THREE.Color(secondaryColor), 2, 20);
    pointLight2.position.set(-3, -2, 2);
    scene.add(pointLight2);

    // Liquid blobs only — no particles
    const blobs: THREE.Mesh[] = [];
    const blobColors = [color, secondaryColor, "#22d3ee", "#f59e0b", "#10b981"];

    for (let i = 0; i < 7; i++) {
      const radius = 0.3 + Math.random() * 0.6;
      const geo = new THREE.SphereGeometry(radius, 32, 32);
      const mat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(blobColors[i % blobColors.length]),
        transparent: true,
        opacity: 0.72 + Math.random() * 0.2,
        roughness: 0.04,
        metalness: 0.08,
        transmission: 0.45,
        thickness: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 3.5,
        (Math.random() - 0.5) * 2
      );
      scene.add(mesh);
      blobs.push(mesh);
    }

    let animating = true;

    function animate() {
      if (!animating) return;
      frameRef.current = requestAnimationFrame(animate);
      const t = performance.now() / 1000;

      blobs.forEach((blob, i) => {
        blob.position.x += Math.sin(t * 0.5 + i) * 0.004;
        blob.position.y += Math.cos(t * 0.4 + i * 1.3) * 0.004;
        blob.position.z += Math.sin(t * 0.3 + i * 0.7) * 0.002;
        blob.rotation.x += 0.004;
        blob.rotation.y += 0.006;
        const s = 1 + Math.sin(t * 1.8 + i) * 0.1;
        blob.scale.set(s, 1 / s, s);

        // Wrap blobs back into view
        if (blob.position.x > 4) blob.position.x = -4;
        if (blob.position.x < -4) blob.position.x = 4;
        if (blob.position.y > 3) blob.position.y = -3;
        if (blob.position.y < -3) blob.position.y = 3;
      });

      pointLight1.position.x = Math.sin(t * 0.5) * 4;
      pointLight1.position.z = Math.cos(t * 0.5) * 4;
      pointLight2.position.x = Math.cos(t * 0.4) * 3;
      pointLight2.position.z = Math.sin(t * 0.4) * 3;

      renderer.render(scene, camera);
    }

    if (autoAnimate) animate();

    const handleResize = () => {
      if (!mount) return;
      const nw = mount.clientWidth;
      camera.aspect = nw / h;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      animating = false;
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [color, secondaryColor, height, autoAnimate]);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ width: "100%", height: `${height}px`, overflow: "hidden" }}
    />
  );
}
