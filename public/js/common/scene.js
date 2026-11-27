// The 3D scene shared by both modes: renderer, camera, sky, snowfield, map meshes, falling snow, puffs,
// the snowball, aim preview, rings and markers, and the snowfighter avatars.
import * as THREE from 'three';
import { TAU, mulberry32, BALL_R, MOVE_RADIUS } from '../../shared/physics.js';
import { $ } from './dom.js';

export { THREE };

/* =========================================================
   Three.js scene
   ========================================================= */
const canvas = $('#c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  $('#err').hidden = false; $('#err').textContent = 'This browser could not start 3D graphics (WebGL). Try another browser or device.';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const SKY = new THREE.Color('#cfe2f1');
scene.fog = new THREE.Fog(SKY, 40, 120);
scene.background = SKY;
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(0, 25, 45);

// sky dome
{
  const g = new THREE.SphereGeometry(300, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#6fa6d6') }, mid: { value: new THREE.Color('#cfe2f1') } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; varying vec3 vp; void main(){ float h = normalize(vp).y; gl_FragColor = vec4(mix(mid, top, smoothstep(0.0, 0.55, h)), 1.0); }'
  });
  scene.add(new THREE.Mesh(g, m));
}
scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x8ea7c2, 1.0));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
sun.position.set(30, 45, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ground: flat inside the arena (radius `flat`), rolling hills beyond it
const groundMat = new THREE.MeshStandardMaterial({ color: 0xf3f8fc, roughness: 0.92, metalness: 0 });
const hillY = (x, z, flat) => { const r = Math.hypot(x, z); return r > flat ? (Math.sin(x * 0.11) * Math.cos(z * 0.09) * 0.5 + 0.6) * (r - flat) * 0.22 + Math.sin(x * 0.4 + z * 0.3) * 0.3 : Math.sin(x * 0.7) * Math.cos(z * 0.6) * 0.03; };
function makeGround(flat) {
  const size = (flat + 96) * 2, seg = Math.round(size / 2);
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hillY(pos.getX(i), pos.getZ(i), flat));
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, groundMat);
  ground.receiveShadow = true;
  return ground;
}

const MAT = {
  snow: new THREE.MeshStandardMaterial({ color: 0xf6fafd, roughness: 0.85 }),
  block: new THREE.MeshStandardMaterial({ color: 0xe3eef7, roughness: 0.8 }),
  blockTall: new THREE.MeshStandardMaterial({ color: 0xc4d4e3, roughness: 0.82 }), // tall walls (full cover) read darker
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 }),
  pine: new THREE.MeshStandardMaterial({ color: 0x1f5b4a, roughness: 0.85 }),
  pine2: new THREE.MeshStandardMaterial({ color: 0x2a6e58, roughness: 0.85 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x27304a, roughness: 0.8 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xf0c7a2, roughness: 0.7 }),
  black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
  carrot: new THREE.MeshStandardMaterial({ color: 0xf08a24, roughness: 0.6 }),
};

// `own`: give the tree its own materials, so it can fade out on its own when it blocks the camera.
function makeTree(s, own = false) {
  const g = new THREE.Group();
  const M = own ? { trunk: MAT.trunk.clone(), pine: MAT.pine.clone(), pine2: MAT.pine2.clone(), snow: MAT.snow.clone() } : MAT;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.3, 8), M.trunk);
  trunk.position.y = 0.65; g.add(trunk);
  const tiers = [[1.7, 2.2, 1.0], [1.3, 1.9, 2.3], [0.9, 1.6, 3.5]];
  tiers.forEach(([r, h, y], i) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9), i % 2 ? M.pine2 : M.pine);
    c.position.y = y + h / 2; g.add(c);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, h * 0.42, 9), M.snow);
    cap.position.y = y + h - h * 0.2; g.add(cap);
  });
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(s);
  if (own) g.userData.mats = Object.values(M);
  return g;
}

// Flags on fort towers.
const FLAGS = [0xe2434b, 0x2f7de1, 0xf2a20c, 0x2bb673].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }));

// A snowman to hide behind: three snowballs, coal eyes and buttons, a carrot nose, stick arms and a hat.
function makeSnowman(s) {
  const g = new THREE.Group();
  for (const [r, y] of [[0.62, 0.55], [0.45, 1.35], [0.32, 1.95]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), MAT.snow); b.position.y = y; g.add(b); }
  for (const sx of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), MAT.black); e.position.set(sx, 2.02, 0.28); g.add(e); }
  for (const y of [1.2, 1.4, 1.6]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), MAT.black); b.position.set(0, y, Math.sqrt(Math.max(0, 0.45 ** 2 - (y - 1.35) ** 2)) - 0.01); g.add(b); }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 8), MAT.carrot); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.94, 0.42); g.add(nose);
  for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.9, 5), MAT.trunk); arm.position.set(sx * 0.7, 1.5, 0); arm.rotation.z = sx * -1.0; g.add(arm); }
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 16), MAT.black); brim.position.y = 2.22; g.add(brim);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.36, 16), MAT.black); hat.position.y = 2.42; g.add(hat);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(s);
  return g;
}

let mapGroup = null;
let fadeTrees = []; // the trees in the arena: { g, x, z, r, top, alpha }
let fadeWalls = []; // tall walls and towers: { g, w, alpha }
// `piles`: the decorative snowballs behind each wall (left out in realtime, where real ones lie on the snow).
function buildMapMeshes(map, piles = true) {
  if (mapGroup) { scene.remove(mapGroup); mapGroup.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); }
  mapGroup = new THREE.Group();
  const size = map.size || 30, flat = size + 4;
  mapGroup.add(makeGround(flat));
  scene.fog.near = size + 10; scene.fog.far = size * 2 + 60;
  const ballGeo = new THREE.SphereGeometry(0.22, 10, 8);
  const crenelGeo = new THREE.BoxGeometry(0.42, 0.34, 0.5);
  // the old map's own (cloned) materials go before the lists are refilled with the new map's
  for (const t of [...fadeTrees, ...fadeWalls]) for (const m of t.g.userData.mats) m.dispose();
  fadeWalls = [];
  for (const w of map.walls) {
    const g = new THREE.Group();
    // tall walls (and towers) get their own materials, so they can fade when they hide the player from the camera
    const tall = w.h >= 2, blockMat = tall ? (w.kind === 'tower' ? MAT.block : MAT.blockTall).clone() : MAT.block;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), blockMat);
    b.position.y = w.h / 2; b.castShadow = b.receiveShadow = true; g.add(b);
    if (w.kind === 'tower') {
      // a tower: snowy top with battlements on each corner, and a flag
      const top = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.15, 0.14, w.d + 0.15), MAT.snow); top.position.y = w.h + 0.05; g.add(top);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const c = new THREE.Mesh(crenelGeo, MAT.block); c.position.set(sx * (w.w / 2 - 0.21), w.h + 0.29, sz * (w.d / 2 - 0.25)); c.castShadow = true; g.add(c); }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), MAT.trunk); pole.position.y = w.h + 0.8; g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.42), FLAGS[Math.abs(Math.round(w.x * 7 + w.z * 3)) % FLAGS.length]); flag.position.set(0.36, w.h + 1.38, 0); g.add(flag);
      g.userData.flag = flag;
    } else if (w.kind === 'fort') {
      // fort walls: a flat snowy top with battlements along it
      const top = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.1, 0.12, w.d + 0.12), MAT.snow); top.position.y = w.h + 0.04; g.add(top);
      for (let x = -w.w / 2 + 0.35; x <= w.w / 2 - 0.2; x += 0.9) { const c = new THREE.Mesh(crenelGeo, MAT.block); c.position.set(x, w.h + 0.27, 0); c.castShadow = true; g.add(c); }
    } else {
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry(w.d * 0.55, Math.max(0.01, w.w - w.d * 1.1), 4, 10), MAT.snow);
      cap.rotation.z = Math.PI / 2; cap.position.y = w.h; cap.scale.set(1, 1, 0.9); cap.castShadow = true; g.add(cap);
      // stockpile of snowballs behind the wall
      if (piles) for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(ballGeo, MAT.snow); s.position.set((i - 1.5) * 0.45, 0.2, -w.d / 2 - 0.35); s.castShadow = true; g.add(s); }
    }
    // the physics turns a wall by ry the other way round from three.js, so the mesh turns by -ry
    g.position.set(w.x, 0, w.z); g.rotation.y = -w.ry;
    mapGroup.add(g);
    if (tall) {
      // every material in this wall's group gets its own copy, so only this wall fades
      const mats = [];
      g.traverse((o) => { if (o.isMesh) { if (o.material !== blockMat) o.material = o.material.clone(); mats.push(o.material); } });
      g.userData.mats = mats;
      fadeWalls.push({ g, w, alpha: 1 });
    }
  }
  for (const m of map.snowmen || []) { const sm = makeSnowman(m.s); sm.position.set(m.x, 0, m.z); sm.rotation.y = m.ry || 0; mapGroup.add(sm); }
  fadeTrees = [];
  for (const t of map.trees) {
    const tr = makeTree(t.s, true); tr.position.set(t.x, 0, t.z); mapGroup.add(tr);
    fadeTrees.push({ g: tr, x: t.x, z: t.z, r: 1.7 * t.s + 0.4, top: 5.1 * t.s, alpha: 1 });
  }
  for (const t of map.deco) {
    const tr = makeTree(t.s * 1.3); tr.position.set(t.x, Math.max(0, hillY(t.x, t.z, flat)) - 0.3, t.z); tr.traverse(o => { if (o.isMesh) o.castShadow = false; }); mapGroup.add(tr);
  }
  // little snowdrifts
  const rng = mulberry32(7);
  for (let i = 0, n = Math.round(26 * (size / 30) ** 2); i < n; i++) {
    const a = rng() * TAU, r = 4 + rng() * (size - 2);
    const d = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), MAT.snow);
    d.scale.set(0.8 + rng() * 1.6, 0.18 + rng() * 0.2, 0.8 + rng() * 1.4); d.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    d.receiveShadow = true; mapGroup.add(d);
  }
  scene.add(mapGroup);
}

// falling snow
const flakeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const SNOW_N = 1800;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) { snowPos[i * 3] = (Math.random() - 0.5) * 90; snowPos[i * 3 + 1] = Math.random() * 30; snowPos[i * 3 + 2] = (Math.random() - 0.5) * 90; }
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.22, map: flakeTex, transparent: true, depthWrite: false, opacity: 0.9 }));
scene.add(snow);

// puffs
const PUFF_N = 240;
const puffGeo = new THREE.BufferGeometry();
const puffPos = new Float32Array(PUFF_N * 3).fill(-999);
const puffVel = new Float32Array(PUFF_N * 3);
const puffLife = new Float32Array(PUFF_N);
let puffIdx = 0;
puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
const puffs = new THREE.Points(puffGeo, new THREE.PointsMaterial({ size: 0.35, map: flakeTex, transparent: true, depthWrite: false }));
puffs.frustumCulled = false;
scene.add(puffs);
function puff(x, y, z, count = 36, spd = 4) {
  for (let i = 0; i < count; i++) {
    const k = puffIdx++ % PUFF_N;
    puffPos[k * 3] = x; puffPos[k * 3 + 1] = y; puffPos[k * 3 + 2] = z;
    const a = Math.random() * TAU, u = Math.random();
    puffVel[k * 3] = Math.cos(a) * spd * u; puffVel[k * 3 + 1] = 1 + Math.random() * spd; puffVel[k * 3 + 2] = Math.sin(a) * spd * u;
    puffLife[k] = 0.6 + Math.random() * 0.5;
  }
}

// ball + trail + aim preview + turn ring
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x334455, emissiveIntensity: 0.2 }));
ball.castShadow = true; ball.visible = false; scene.add(ball);
const PREV_N = 18;
const prevGeo = new THREE.BufferGeometry();
prevGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREV_N * 3), 3));
const preview = new THREE.Points(prevGeo, new THREE.PointsMaterial({ size: 0.28, map: flakeTex, color: 0xffc83a, transparent: true, depthWrite: false }));
preview.frustumCulled = false; preview.visible = false; scene.add(preview);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 40), new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; scene.add(ring);
// where you may walk this turn, and where you will stand
const moveRing = new THREE.Mesh(new THREE.RingGeometry(MOVE_RADIUS - 0.1, MOVE_RADIUS, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
moveRing.rotation.x = -Math.PI / 2; moveRing.position.y = 0.05; moveRing.visible = false; scene.add(moveRing);
const moveFill = new THREE.Mesh(new THREE.CircleGeometry(MOVE_RADIUS, 72), new THREE.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
moveFill.rotation.x = -Math.PI / 2; moveFill.position.y = 0.045; moveFill.visible = false; scene.add(moveFill);
const marker = new THREE.Group();
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
{ const r = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 36), markerMat); r.rotation.x = -Math.PI / 2; r.position.y = 0.06; marker.add(r);
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), markerMat); c.rotation.x = Math.PI; c.position.y = 0.9; marker.add(c); }
marker.visible = false; scene.add(marker);

/* ---------- avatars ---------- */
function makeAvatar(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const jacket = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const hatMat = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.7), roughness: 0.8 });
  const scarfMat = new THREE.MeshStandardMaterial({ color: c.getHSL({}).l > 0.5 ? 0x14233d : 0xfff3d6, roughness: 0.8 });
  const body = new THREE.Group(); g.add(body);
  const legs = [], knees = [], boots = [];
  for (const sx of [-0.14, 0.14]) {
    const hip = new THREE.Group(); hip.position.set(sx, 0.62, 0); body.add(hip); legs.push(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.115, 0.3, 10), MAT.dark); thigh.position.y = -0.15; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.3; hip.add(knee); knees.push(knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.26, 10), MAT.dark); shin.position.y = -0.13; knee.add(shin);
    const boot = new THREE.Group(); boot.position.y = -0.26; knee.add(boot); boots.push(boot);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), MAT.dark); b.scale.set(1, 0.6, 1.4); b.position.z = 0.05; boot.add(b);
  }
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), jacket); torso.scale.set(1, 1.2, 0.88); torso.position.y = 1.0; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), MAT.skin); head.position.y = 1.72; body.add(head);
  for (const sx of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), MAT.black); e.position.set(sx, 1.76, 0.27); body.add(e); }
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), MAT.carrot); cheek.position.set(0, 1.69, 0.3); body.add(cheek);
  const hatGroup = new THREE.Group(); hatGroup.position.y = 1.77; body.add(hatGroup); // pops off on a head shot
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.315, 18, 10, 0, TAU, 0, Math.PI / 2), hatMat); hatGroup.add(hat);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.06, 8, 20), hatMat); brim.rotation.x = Math.PI / 2; brim.position.y = 0.01; hatGroup.add(brim);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), MAT.snow); pom.position.y = 0.33; hatGroup.add(pom);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 8, 20), scarfMat); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.46; body.add(scarf);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.06), scarfMat); tail.position.set(0.15, 1.25, 0.3); tail.rotation.z = 0.2; body.add(tail);
  const arms = [], elbows = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0.4 * sx, 1.28, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.095, 0.28, 8), jacket); arm.position.y = -0.14; pivot.add(arm);
    const elbow = new THREE.Group(); elbow.position.y = -0.28; pivot.add(elbow); elbows.push(elbow);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.25, 8), jacket); forearm.position.y = -0.125; elbow.add(forearm);
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), hatMat); mitt.position.y = -0.28; elbow.add(mitt);
    pivot.rotation.z = 0.25 * sx;
    body.add(pivot); arms.push(pivot);
  }
  const handBall = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 10, 8), MAT.snow); handBall.position.y = -0.34; elbows[0].add(handBall);
  const splat = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), MAT.snow); splat.scale.set(1, 1, 0.4); splat.position.set(0, 1.1, 0.38); splat.visible = false; body.add(splat);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // Twist at the waist without dragging the feet around; keep existing part coordinates for hit/emote effects.
  const upper = new THREE.Group(), upperParts = new THREE.Group();
  upper.position.y = 0.9; upperParts.position.y = -0.9; upper.add(upperParts);
  for (const part of [...body.children]) if (!legs.includes(part)) upperParts.add(part);
  body.add(upper);
  g.userData = { body, upper, throwArm: arms[0], freeArm: arms[1], elbows, legs, knees, boots, handBall, splat, hat: hatGroup };
  scene.add(g);
  return g;
}
function disposeAvatar(a) { scene.remove(a); a.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); }

// More snowballs, for realtime mode where several can fly at once and loose ones lie on the snow.
const ballGeoShared = new THREE.SphereGeometry(BALL_R, 16, 12);
export function makeBallMesh(scale = 1) {
  const m = new THREE.Mesh(ballGeoShared, ball.material);
  m.castShadow = true; m.scale.setScalar(scale); scene.add(m);
  return m;
}
export function removeMesh(m) { scene.remove(m); }

// Trees standing between the camera and what it looks at (the player, or a snowball in flight) fade out,
// and come back once they're out of the way. Tall walls fade when they block the line to `target` or to any of
// `more` (realtime passes the avatar too: a wall right behind you can hide you while the line to a point ahead
// passes over it).
export function fadeBlockingTrees(target, dt, more = []) {
  const c = camera.position, dx = target.x - c.x, dz = target.z - c.z, len2 = dx * dx + dz * dz || 1;
  for (const t of fadeTrees) {
    // closest point on the camera-to-target line (seen from above), and how far the tree is from it
    const k = Math.max(0, Math.min(1, ((t.x - c.x) * dx + (t.z - c.z) * dz) / len2));
    const d = Math.hypot(c.x + dx * k - t.x, c.z + dz * k - t.z);
    const blocks = d < t.r && k < 1 && c.y < t.top + 1;
    fadeTo(t, blocks ? 0.1 : 1, dt);
  }
  // tall walls: does the camera's line of sight pass through the wall's box (a little wider), below its top?
  for (const f of fadeWalls) {
    const w = f.w, cs = Math.cos(-w.ry), sn = Math.sin(-w.ry), hw = w.w / 2 + 0.3, hd = w.d / 2 + 0.3;
    let blocks = false;
    for (const to of [target, ...more]) {
      const ex = to.x - c.x, ez = to.z - c.z;
      for (let k = 1; k < 24 && !blocks; k++) {
        const t = k / 24, x = c.x + ex * t - w.x, z = c.z + ez * t - w.z, y = c.y + (1.2 - c.y) * t;
        blocks = Math.abs(x * cs - z * sn) < hw && Math.abs(x * sn + z * cs) < hd && y < w.h + 0.3;
      }
    }
    fadeTo(f, blocks ? 0.18 : 1, dt);
  }
}

// Ease something with its own materials towards an opacity.
function fadeTo(t, want, dt) {
  if (Math.abs(t.alpha - want) < 0.005) return;
  t.alpha += (want - t.alpha) * Math.min(1, dt * 8);
  if (Math.abs(t.alpha - want) < 0.01) t.alpha = want;
  const see = t.alpha < 0.999;
  for (const m of t.g.userData.mats) { m.transparent = see; m.opacity = t.alpha; m.depthWrite = !see; m.needsUpdate = true; }
}

// Camera easing toward a wanted position and look-at point.
export const camLook = new THREE.Vector3(0, 0, 0);
export function easeCamera(want, look, k, dt) {
  camera.position.lerp(want, Math.min(1, dt * k));
  camLook.lerp(look, Math.min(1, dt * k * 1.5));
  camera.lookAt(camLook);
}
// The slow orbit behind the menu and lobby.
export function orbitCamera(time, dt) {
  const a = time * 0.05;
  easeCamera(new THREE.Vector3(Math.sin(a) * 42, 20, Math.cos(a) * 42), new THREE.Vector3(0, 2, 0), 1, dt);
}

export function updateParticles(dt, wind) {
  for (let i = 0; i < PUFF_N; i++) {
    if (puffLife[i] <= 0) continue;
    puffLife[i] -= dt;
    if (puffLife[i] <= 0) { puffPos[i * 3 + 1] = -999; continue; }
    puffVel[i * 3 + 1] -= 9 * dt;
    puffPos[i * 3] += puffVel[i * 3] * dt; puffPos[i * 3 + 1] = Math.max(0.05, puffPos[i * 3 + 1] + puffVel[i * 3 + 1] * dt); puffPos[i * 3 + 2] += puffVel[i * 3 + 2] * dt;
  }
  puffGeo.attributes.position.needsUpdate = true;
  const w = wind || { x: 0, z: 0 };
  for (let i = 0; i < SNOW_N; i++) {
    snowPos[i * 3 + 1] -= dt * (1.2 + (i % 7) * 0.12);
    snowPos[i * 3] += w.x * dt * 0.8 + Math.sin(i + snowPos[i * 3 + 1]) * dt * 0.2;
    snowPos[i * 3 + 2] += w.z * dt * 0.8;
    if (snowPos[i * 3 + 1] < 0) { snowPos[i * 3 + 1] = 30; snowPos[i * 3] = camera.position.x + (Math.random() - 0.5) * 90; snowPos[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 90; }
  }
  snowGeo.attributes.position.needsUpdate = true;
}

// Show the aim preview along a simulated path: the first few metres, or with `full` the whole arc.
export function showPreview(sim, full = false) {
  const arr = prevGeo.attributes.position.array;
  for (let i = 0; i < PREV_N; i++) { const k = full ? Math.round(i * (sim.n - 1) / (PREV_N - 1)) : Math.min(sim.n - 1, i * 3); arr[i * 3] = sim.pts[k * 3]; arr[i * 3 + 1] = sim.pts[k * 3 + 1]; arr[i * 3 + 2] = sim.pts[k * 3 + 2]; }
  prevGeo.attributes.position.needsUpdate = true;
  preview.visible = true;
}

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 68 : 55; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

export function render() {
  sun.position.set(camLook.x + 30, 45, camLook.z + 18);
  sun.target.position.set(camLook.x, 0, camLook.z);
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
}

export { canvas, renderer, scene, camera, buildMapMeshes, puff, ball, preview, ring, moveRing, moveFill, marker, markerMat, makeAvatar, disposeAvatar };
