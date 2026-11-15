// The arsenal: four guns and two grenades, each with its own numbers, price and view
// model. The weapon owns magazines, reserve ammo, reload timing, recoil and spread;
// the simulation owns the ray and the damage. Spread grows with speed and with
// sustained fire, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P-9 Cendrawasih', kind: 'pistol', price: 0,
    damage: 26, headMult: 2, mag: 12, reserve: 48, gap: 0.16, auto: false,
    reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, kick: 0.011, range: 60,
  },
  rifle: {
    id: 'rifle', name: 'AR-7 Kijang', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, mag: 30, reserve: 90, gap: 0.096, auto: true,
    reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, range: 90,
  },
  smg: {
    id: 'smg', name: 'SM-5 Badak', kind: 'smg', price: 1700,
    damage: 24, headMult: 4, mag: 28, reserve: 84, gap: 0.07, auto: true,
    reload: 1.6, spreadStill: 0.005, spreadMove: 0.034, kick: 0.007, range: 45,
  },
  sniper: {
    id: 'sniper', name: 'SR-12 Garuda', kind: 'sniper', price: 4200,
    damage: 88, headMult: 4, mag: 5, reserve: 15, gap: 1.15, auto: false,
    reload: 2.6, spreadStill: 0.0006, spreadMove: 0.05, kick: 0.032, range: 120,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Granat Pecah', price: 300, radius: 6.5, maxDamage: 105 },
  smoke: { id: 'smoke', name: 'Granat Asap', price: 250, radius: 4.5, duration: 14 },
};

const BUY_ORDER = ['rifle', 'smg', 'sniper'];

export function createWeapon(camera) {
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f45'), roughness: 0.45, metalness: 0.6 });
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.containerRust), roughness: 0.8, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }
  const state = {
    current: 'rifle',
    owned: ['pistol', 'rifle'],
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    heat: 0,
    grenades: { frag: 1, smoke: 0 },
  };

  function buildModel(def) {
    while (model.children.length > 0) model.remove(model.children[0]);
    const parts = [];
    if (def.kind === 'pistol') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.26), steel);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.07), gripMat);
      grip.position.set(0, -0.07, 0.08);
      parts.push(slide, grip);
    } else if (def.kind === 'sniper') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), steel);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.62), steel);
      barrel.position.set(0, 0.02, -0.52);
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), accentMat);
      scope.position.set(0, 0.09, -0.05);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.26), gripMat);
      stock.position.set(0, -0.02, 0.36);
      parts.push(receiver, barrel, scope, stock);
    } else {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, def.kind === 'smg' ? 0.34 : 0.44), steel);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.36), steel);
      barrel.position.set(0, 0.025, -0.38);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gripMat);
      mag.position.set(0, -0.11, -0.05);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.2), gripMat);
      stock.position.set(0, -0.02, 0.3);
      parts.push(receiver, barrel, mag, stock);
      if (def.kind === 'rifle') {
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.1), accentMat);
        sight.position.set(0, 0.085, -0.08);
        parts.push(sight);
      }
    }
    for (const part of parts) model.add(part);
    model.position.set(0.24, -0.2, -0.42);
    model.rotation.set(0, 0, 0);
  }

  buildModel(WEAPONS[state.current]);

  function currentDef() {
    return WEAPONS[state.current];
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.heat = Math.max(0, state.heat - dt * 2.2);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 + state.kick * 0.35;
    model.rotation.x = state.kick * 2.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 28;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / currentDef().reload;
      model.rotation.x = -0.5 * Math.sin(progress * Math.PI);
      if (state.reloadLeft === 0) {
        const slot = ammo[state.current];
        const need = currentDef().mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
    if (moving) state.heat = Math.min(0.5, state.heat + dt * 0.1);
  }

  return {
    state,
    ammo,
    defs: WEAPONS,
    grenadeDefs: GRENADES,
    buyOrder: BUY_ORDER,
    currentDef,
    step,
    ready() {
      const slot = ammo[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      const slot = ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = currentDef().gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.heat = Math.min(1, state.heat + 0.16);
    },
    reload() {
      const slot = ammo[state.current];
      if (state.reloadLeft > 0 || slot.mag === currentDef().mag || slot.reserve === 0) return false;
      state.reloadLeft = currentDef().reload;
      return true;
    },
    spread(speed, aiming) {
      const def = currentDef();
      const moveFactor = Math.min(1, speed / 5.4);
      let value = def.spreadStill + moveFactor * def.spreadMove + state.heat * 0.012;
      if (aiming) value *= 0.45;
      return value;
    },
    equip(id) {
      if (!state.owned.includes(id) || state.reloadLeft > 0) return false;
      state.current = id;
      state.cooldown = 0.25;
      buildModel(WEAPONS[id]);
      return true;
    },
    buyGun(id) {
      if (state.owned.includes(id)) return false;
      state.owned.push(id);
      return true;
    },
    refillAmmo(id) {
      ammo[id].reserve = WEAPONS[id].reserve;
    },
    useGrenade(kind) {
      if (state.grenades[kind] <= 0) return false;
      state.grenades[kind] -= 1;
      return true;
    },
    addGrenade(kind) {
      state.grenades[kind] += 1;
    },
    resetRound() {
      for (const id of Object.keys(WEAPONS)) {
        ammo[id].mag = WEAPONS[id].mag;
        if (state.owned.includes(id)) ammo[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.heat = 0;
      if (!state.owned.includes(state.current)) state.current = 'pistol';
      buildModel(WEAPONS[state.current]);
    },
  };
}
