// Senja Harbor: a dusk container port. Two plant sites (Dermaga west, Gudang east),
// a mid lane, a warehouse interior, a gantry crane, and container stacks for cover.
// Every box is axis aligned so the AABB colliders stay exact. The map also owns the
// waypoint graph bots walk on, the shared raycaster for sight and bullets, and the
// axis-separated box mover the player and the bots both use.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HALF_X = 28;
const HALF_Z = 20;
const WALL_H = 5;

export const SITES = {
  A: { name: 'Dermaga', center: new THREE.Vector3(-20, 0, -13), radius: 4.2 },
  B: { name: 'Gudang', center: new THREE.Vector3(20, 0, -13), radius: 4.2 },
};

// Waypoint graph: index -> [x, z, ...neighbour indices]. Bots BFS through it.
const NODES = [
  [0, 16, 1, 19, 20],
  [0, 8, 0, 2, 17, 18],
  [0, 0, 1, 3, 4, 7, 12],
  [0, -8, 2, 4, 7, 21],
  [-12, -2, 2, 3, 5, 6, 12],
  [-20, -13, 4, 6, 14],
  [-24, -4, 4, 5, 10],
  [12, -2, 2, 3, 8, 9, 21],
  [20, -13, 7, 9, 15, 16],
  [14, -6, 7, 8, 11, 16],
  [-20, 6, 6, 17, 19],
  [20, 6, 9, 18, 20],
  [-6, -8, 2, 4, 21],
  [0, -16, 14, 15, 21],
  [-22, -16, 5, 6, 13],
  [22, -16, 8, 13],
  [19, -10, 8, 9],
  [-6, 4, 1, 2, 10],
  [10, 2, 1, 2, 11],
  [-12, 12, 0, 10],
  [12, 12, 0, 11],
  [6, -12, 3, 7, 12, 13],
];

export const SPAWNS = {
  elang: [
    [0, 16],
    [-3, 17],
    [3, 17],
  ],
  komodo: [
    [0, -16],
    [-5, -16],
    [5, -16],
    [10, -16],
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'lamp' ? 0.5 : 0.9,
      metalness: name.startsWith('container') ? 0.35 : 0.05,
    });
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const seaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0e2a33'), roughness: 0.25, metalness: 0.6, emissive: new THREE.Color('#0a1e26'), emissiveIntensity: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#10161c'), roughness: 0.95 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[material] || darkMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function plate(text, w, h, x, y, z, yaw, bg, fg) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = fg;
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.08),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  function ring(cx, cz) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.9, 40), glowMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, 0.03, cz);
    group.add(mesh);
    return mesh;
  }

  // Ground and perimeter.
  box(60, 0.4, 44, 0, -0.2, 0, 'asphalt');
  box(0.6, WALL_H, 44, -HALF_X - 0.3, WALL_H / 2, 0, 'containerSlate');
  box(0.6, WALL_H, 44, HALF_X + 0.3, WALL_H / 2, 0, 'containerSlate');
  box(60, WALL_H, 0.6, 0, WALL_H / 2, -HALF_Z - 0.3, 'containerSlate');
  box(60, WALL_H, 0.6, 0, WALL_H / 2, HALF_Z + 0.3, 'containerSlate');

  // Yellow lane paint, flat strips just above the ground (not solid).
  const paint = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.marking), transparent: true, opacity: 0.5 });
  for (const [w, d, x, z] of [[0.35, 10, 0, 4], [0.35, 10, -14, 2], [0.35, 10, 14, 2], [10, 0.35, 0, 12]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.02, z);
    group.add(strip);
  }

  // Site markers and signs.
  ring(SITES.A.center.x, SITES.A.center.z);
  ring(SITES.B.center.x, SITES.B.center.z);
  plate('DERMAGA', 3.4, 1.7, -20, 4.4, -18.6, 0, '#2f6f6a', '#f2ead9');
  plate('GUDANG', 3.4, 1.7, 20, 4.4, -18.6, 0, '#c96a2e', '#f2ead9');
  plate('SENJA HARBOR', 5, 2.2, 0, 4.6, 19.6, Math.PI, '#16303e', '#ff9a3d');

  // Warehouse around Site B: walls with two door gaps, a flat roof, interior crates.
  box(0.5, WALL_H, 12, 11.75, WALL_H / 2, -13, 'containerRust');
  box(0.5, WALL_H, 12, 26.25, WALL_H / 2, -13, 'containerRust');
  box(4.5, WALL_H, 0.5, 13.75, WALL_H / 2, -6.75, 'containerRust');
  box(4.5, WALL_H, 0.5, 23.75, WALL_H / 2, -6.75, 'containerRust');
  box(15, 0.4, 12.5, 19, 4.8, -13, 'containerSlate');
  box(2.4, 1.3, 2.4, 15, 0.65, -15, 'containerTeal');
  box(2.4, 1.3, 2.4, 23, 0.65, -10, 'containerSand');

  // Container stacks: the cover that makes the lanes.
  box(6, 2.6, 2.4, -16, 1.3, 0, 'containerTeal');
  box(6, 2.6, 2.4, -14.5, 3.9, 0, 'containerOrange');
  box(6, 2.6, 2.4, 8, 1.3, 4, 'containerOrange');
  box(4, 2.6, 2.4, 9, 3.9, 4, 'containerSlate');
  box(2.4, 2.6, 6, -8, 1.3, -10, 'containerRust');
  box(6, 2.6, 2.4, 16, 1.3, 8, 'containerSlate');
  box(3, 1.3, 2.4, -24, 0.65, 6, 'containerTeal');
  box(4, 2.6, 2.4, 0, 1.3, -12, 'containerOrange');
  box(2.4, 1.3, 2.4, -2, 0.65, 10, 'containerSand');
  box(2.4, 2.6, 4, 24, 1.3, -2, 'containerRust');
  box(3, 2.6, 2.4, -26, 1.3, -14, 'containerTeal');
  box(6, 1.3, 2.4, -14, 0.65, -16, 'containerSlate');
  box(6, 2.6, 2.4, -12, 1.3, 12, 'containerTeal');
  box(6, 2.6, 2.4, 12, 1.3, 12, 'containerSlate');
  box(3, 1.3, 2.4, 6, 0.65, 14, 'containerSand');

  // Gantry crane across the north half: two legs, a beam, a hanging spreader.
  box(1.2, 9, 1.2, -14, 4.5, -8, 'containerSand');
  box(1.2, 9, 1.2, 14, 4.5, -8, 'containerSand');
  box(30, 1, 1.4, 0, 9.2, -8, 'containerSand');
  box(0.12, 5, 0.12, 2, 6.4, -8, 'asphalt', false);
  box(2, 1.5, 2, 2, 3.4, -8, 'containerOrange');

  // Lamp posts with warm point lights.
  for (const [x, z] of [[-24, 2], [0, -14], [24, 2], [-12, 16], [16, 16]]) {
    box(0.18, 4.5, 0.18, x, 2.25, z, 'asphalt');
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp) }));
    head.position.set(x, 4.55, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.lamp), 22, 20, 2);
    light.position.set(x, 4.3, z);
    group.add(light);
  }

  // Dusk sun low over the sea, hemisphere fill, and a dim cool fill from the south.
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.horizon), 2.4);
  sun.position.set(-18, 7, -26);
  sun.target.position.set(4, 0, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color('#3d6a7a'), new THREE.Color('#1c1a18'), 0.85);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a7d8c'), 0.5);
  fill.position.set(10, 12, 18);
  scene.add(fill);

  // The sea beyond the north wall and a moored ship silhouette.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 26), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.15, -34);
  group.add(sea);
  const ship = new THREE.Mesh(new THREE.BoxGeometry(26, 5, 7), darkMat);
  ship.position.set(-8, 1.2, -30);
  group.add(ship);
  box(8, 2.6, 2.4, -14, 5.6, -30, 'containerTeal', false);
  box(8, 2.6, 2.4, -4, 5.6, -30, 'containerOrange', false);

  // City silhouette beyond the south wall.
  for (const [w, h, x] of [[6, 9, -20], [5, 13, -8], [7, 7, 6], [5, 11, 18], [6, 8, 25]]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), darkMat);
    tower.position.set(x, h / 2, 26);
    group.add(tower);
  }

  // Shared raycaster, reused so sight and bullet tests allocate nothing per call.
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const rayTarget = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  function hasLineOfSight(a, b, blockers) {
    rayTarget.copy(b).sub(a);
    const dist = rayTarget.length();
    if (dist < 0.01) return true;
    rayDir.copy(rayTarget).normalize();
    raycaster.set(a, rayDir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(shootables, false);
    if (hits.length > 0) return false;
    if (blockers) {
      for (const blocker of blockers) {
        if (blocker.blocks(a, b)) return false;
      }
    }
    return true;
  }

  function rayHit(origin, dir, maxDist, extra) {
    raycaster.set(origin, dir);
    raycaster.far = maxDist;
    const list = extra ? shootables.concat(extra) : shootables;
    const hits = raycaster.intersectObjects(list, false);
    return hits.length > 0 ? hits[0] : null;
  }

  // Axis-separated box mover: slide along walls instead of sticking to them.
  const probe = new THREE.Box3();
  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function moveBox(pos, vel, dt, radius, height) {
    const nextX = pos.x + vel.x * dt;
    if (!overlaps(nextX, pos.y, pos.z, radius, height, 0.04)) pos.x = nextX;
    else vel.x = 0;
    const nextZ = pos.z + vel.z * dt;
    if (!overlaps(pos.x, pos.y, nextZ, radius, height, 0.04)) pos.z = nextZ;
    else vel.z = 0;
    pos.y += vel.y * dt;
    const hit = overlaps(pos.x, pos.y, pos.z, radius, height, 0);
    if (hit && vel.y <= 0) {
      pos.y = hit.max.y;
      vel.y = 0;
      return true;
    }
    if (hit) {
      pos.y = hit.min.y - height;
      vel.y = 0;
    }
    if (pos.y < 0) {
      pos.y = 0;
      vel.y = 0;
      return true;
    }
    return false;
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      const dx = x - s.center.x;
      const dz = z - s.center.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) return key;
    }
    return null;
  }

  return {
    colliders,
    shootables,
    group,
    nodes: NODES,
    hasLineOfSight,
    rayHit,
    moveBox,
    siteAt,
  };
}
