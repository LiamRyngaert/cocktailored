import { useEffect, useRef } from "react";
import * as THREE from "three";

interface CocktailGlass3DProps {
  color?: string;
  secondaryColor?: string;
  className?: string;
  height?: number;
}

export default function CocktailGlass3D({
  color = "#ff6b35",
  secondaryColor = "#a855f7",
  className = "",
  height = 400,
}: CocktailGlass3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 400;
    const h = height;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    camera.position.set(0, 1.5, 6);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(new THREE.Color(color), 3);
    keyLight.position.set(3, 5, 3);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(new THREE.Color(secondaryColor), 2, 15);
    fillLight.position.set(-3, 2, 2);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1);
    rimLight.position.set(0, 3, -5);
    scene.add(rimLight);

    // Glass group
    const glassGroup = new THREE.Group();
    scene.add(glassGroup);

    // Glass body (martini-style cone)
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      roughness: 0,
      metalness: 0,
      transmission: 0.95,
      thickness: 0.3,
      reflectivity: 1,
      ior: 1.5,
    });

    // Cone (glass bowl) - open top
    const coneGeo = new THREE.CylinderGeometry(1.4, 0.15, 2, 32, 1, true);
    const coneMesh = new THREE.Mesh(coneGeo, glassMat);
    coneMesh.position.y = 1.0;
    glassGroup.add(coneMesh);

    // Glass rim (torus)
    const rimGeo = new THREE.TorusGeometry(1.4, 0.04, 16, 64);
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      roughness: 0,
      metalness: 0.2,
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = 2.0;
    glassGroup.add(rimMesh);

    // Stem
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 16);
    const stemMesh = new THREE.Mesh(stemGeo, glassMat);
    stemMesh.position.y = -0.6;
    glassGroup.add(stemMesh);

    // Base
    const baseGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.08, 32);
    const baseMesh = new THREE.Mesh(baseGeo, glassMat);
    baseMesh.position.y = -1.24;
    glassGroup.add(baseMesh);

    // Liquid inside
    const liquidColor = new THREE.Color(color);
    const liquidMat = new THREE.MeshPhysicalMaterial({
      color: liquidColor,
      transparent: true,
      opacity: 0.82,
      roughness: 0.05,
      metalness: 0.1,
      transmission: 0.3,
      emissive: liquidColor,
      emissiveIntensity: 0.2,
    });

    // Liquid surface (slightly below rim)
    const liquidGeo = new THREE.CylinderGeometry(1.25, 0.12, 1.85, 32);
    const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
    liquidMesh.position.y = 0.95;
    glassGroup.add(liquidMesh);

    // Floating garnish (small sphere)
    const garnishGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const garnishMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(secondaryColor),
      roughness: 0.3,
      metalness: 0.1,
      emissive: new THREE.Color(secondaryColor),
      emissiveIntensity: 0.3,
    });
    const garnish = new THREE.Mesh(garnishGeo, garnishMat);
    garnish.position.set(0.8, 2.1, 0);
    glassGroup.add(garnish);

    // Bubbles inside liquid
    const bubbles: THREE.Mesh[] = [];
    const bubbleMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      roughness: 0,
      transmission: 0.9,
    });
    for (let i = 0; i < 12; i++) {
      const r = 0.03 + Math.random() * 0.06;
      const bGeo = new THREE.SphereGeometry(r, 8, 8);
      const bubble = new THREE.Mesh(bGeo, bubbleMat);
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.8;
      bubble.position.set(
        Math.cos(angle) * rad,
        0.2 + Math.random() * 1.5,
        Math.sin(angle) * rad
      );
      glassGroup.add(bubble);
      bubbles.push(bubble);
    }

    // Splash particles around glass
    const splashCount = 40;
    const splashGeo = new THREE.BufferGeometry();
    const splashPos = new Float32Array(splashCount * 3);
    const splashVel: THREE.Vector3[] = [];
    const splashColors = new Float32Array(splashCount * 3);
    const c1 = new THREE.Color(color);
    const c2 = new THREE.Color(secondaryColor);

    for (let i = 0; i < splashCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 1.0 + Math.random() * 0.5;
      splashPos[i * 3] = Math.cos(angle) * r;
      splashPos[i * 3 + 1] = 1.8 + Math.random() * 0.5;
      splashPos[i * 3 + 2] = Math.sin(angle) * r;
      splashVel.push(new THREE.Vector3(
        Math.cos(angle) * (0.01 + Math.random() * 0.02),
        0.01 + Math.random() * 0.03,
        Math.sin(angle) * (0.01 + Math.random() * 0.02)
      ));
      const lc = c1.clone().lerp(c2, Math.random());
      splashColors[i * 3] = lc.r;
      splashColors[i * 3 + 1] = lc.g;
      splashColors[i * 3 + 2] = lc.b;
    }
    splashGeo.setAttribute("position", new THREE.BufferAttribute(splashPos, 3));
    splashGeo.setAttribute("color", new THREE.BufferAttribute(splashColors, 3));
    const splashMat = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });
    const splashParticles = new THREE.Points(splashGeo, splashMat);
    scene.add(splashParticles);

    // Animation
    
    let animating = true;
    let frame = 0;

    function animate() {
      if (!animating) return;
      frame = requestAnimationFrame(animate);
      const t = performance.now() / 1000;

      // Gentle glass rotation
      glassGroup.rotation.y = Math.sin(t * 0.4) * 0.3;
      glassGroup.position.y = Math.sin(t * 0.6) * 0.05;

      // Bubble rise
      bubbles.forEach((b, i) => {
        b.position.y += 0.004;
        if (b.position.y > 2.1) b.position.y = 0.2;
        b.position.x += Math.sin(t * 2 + i) * 0.002;
      });

      // Garnish bob
      garnish.position.y = 2.1 + Math.sin(t * 2) * 0.05;
      garnish.rotation.y += 0.02;

      // Splash particles
      const sp = splashGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < splashCount; i++) {
        sp.array[i * 3] += splashVel[i].x;
        sp.array[i * 3 + 1] += splashVel[i].y;
        sp.array[i * 3 + 2] += splashVel[i].z;
        splashVel[i].y -= 0.0006;
        if (sp.array[i * 3 + 1] < 0.5 || Math.abs(sp.array[i * 3] as number) > 3) {
          const angle = Math.random() * Math.PI * 2;
          const r = 0.8 + Math.random() * 0.4;
          sp.array[i * 3] = Math.cos(angle) * r;
          sp.array[i * 3 + 1] = 1.8;
          sp.array[i * 3 + 2] = Math.sin(angle) * r;
          splashVel[i].set(
            Math.cos(angle) * (0.01 + Math.random() * 0.02),
            0.015 + Math.random() * 0.025,
            Math.sin(angle) * (0.01 + Math.random() * 0.02)
          );
        }
      }
      sp.needsUpdate = true;

      // Rotate lights
      keyLight.position.x = Math.sin(t * 0.3) * 4;
      keyLight.position.z = Math.cos(t * 0.3) * 4;

      renderer.render(scene, camera);
    }

    animate();

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
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [color, secondaryColor, height]);

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ width: "100%", height: `${height}px`, overflow: "hidden" }}
    />
  );
}
