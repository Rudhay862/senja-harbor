// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display
// rate. Input, HUD and audio are drained here; the simulation itself never touches
// them. ?shot=start|play|end with &seed=N stages a deterministic capture instead
// of the interactive loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createSim } from './sim.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createShots } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 22, 68);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const sim = createSim(scene, camera, world, rng);
const hud = createHud();
const audio = createAudio();
const shots = createShots(sim, hud, camera, world);
const input = createInput(renderer.domElement, onLockChange, onAction);

const body = sim.player.state;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let buyVisible = false;
let lastStepCount = 0;

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const fovTarget = body.aiming ? 58 : 74;
  if (Math.abs(camera.fov - fovTarget) > 0.1) {
    camera.fov += (fovTarget - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function onAction(code) {
  if (code === 'KeyB') {
    if (sim.rounds.state.buyOpen) {
      buyVisible = !buyVisible;
      refreshBuyMenu();
    }
  }
  if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4' || code === 'Digit5') {
    if (sim.rounds.state.buyOpen && buyVisible) {
      const items = sim.buildBuyItems();
      const item = items[Number(code.slice(-1)) - 1];
      if (item && !item.disabled) buyItem(item.id);
    }
  }
}

function refreshBuyMenu() {
  if (!buyVisible) {
    hud.showBuy(false);
    return;
  }
  hud.buildBuyMenu(sim.buildBuyItems(), buyItem);
  hud.showBuy(true);
}

function buyItem(id) {
  const before = sim.rounds.state.money;
  sim.rounds.buy(id, sim.events);
  if (sim.rounds.state.money !== before) {
    audio.click();
    refreshBuyMenu();
    syncHud();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    if (sim.rounds.state.buyOpen && !buyVisible) {
      buyVisible = true;
      refreshBuyMenu();
    }
  } else if (sim.rounds.state.matchOver) {
    hud.showOverlay('matchEnd', `Skor akhir ${sim.rounds.state.score.elang} — ${sim.rounds.state.score.komodo}. ${sim.rounds.state.score.elang > sim.rounds.state.score.komodo ? 'ELANG juara Senja Harbor.' : 'KOMODO juara Senja Harbor.'}`);
  } else if (!sim.player.state.alive) {
    hud.showOverlay('roundEnd', 'Kamu gugur. Ronde berlanjut — rekan setimmu masih bertarung.');
  } else {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (sim.rounds.state.matchOver) {
    sim.resetMatch();
    sim.rounds.state.money = 800;
    buyVisible = true;
  }
  input.requestLock();
});

function syncHud() {
  const rounds = sim.rounds.state;
  const weapon = sim.weapon;
  const slot = weapon.ammo[weapon.state.current];
  hud.setHealth(Math.ceil(body.health));
  hud.setAmmo(slot.mag, slot.reserve, weapon.currentDef().name);
  hud.setGrenades(weapon.state.grenades.frag, weapon.state.grenades.smoke);
  hud.setMoney(rounds.money);
  hud.setTimer(rounds.timer);
  hud.setScore(rounds.score.elang, rounds.score.komodo);
  const elangAlive = (body.alive ? 1 : 0) + sim.bots.aliveCount('elang');
  hud.setAlive(elangAlive, sim.bots.aliveCount('komodo'));
  const spreadPx = 4 + weapon.spread(sim.player.groundSpeed(), body.aiming) * 900;
  hud.setCrosshair(spreadPx);
  hud.setScope(weapon.state.current === 'sniper' && body.aiming);
  const bomb = rounds.bomb;
  if (bomb.planted) {
    hud.setBomb(`Perangkat aktif di Site ${bomb.siteKey} — meledak ${Math.ceil(bomb.detonateIn)} dtk`);
  } else if (bomb.holder === 'player') {
    hud.setBomb('Perangkat ada padamu — pasang di Dermaga / Gudang [E]');
  } else if (bomb.holder === 'bot') {
    hud.setBomb('Rekanmu membawa perangkat');
  } else {
    hud.setBomb('Perangkat terjatuh — ambil alih');
  }
  if (sim.state.plantProgress > 0) {
    hud.setPlant('Memasang perangkat…', sim.state.plantProgress);
  } else if (sim.state.defuseProgress > 0) {
    hud.setPlant('Musuh menjinakkan perangkat!', sim.state.defuseProgress);
  } else {
    hud.setPlant('', 0);
  }
  const site = world.siteAt(body.position.x, body.position.z);
  if (rounds.phase === 'live' && bomb.holder === 'player' && site && body.alive) {
    hud.setHint(`Kamu di Site ${site} — tahan E untuk memasang perangkat`);
  } else if (rounds.phase === 'buy') {
    hud.setHint('Fase beli — tekan B untuk toko, 1–5 untuk membeli');
  } else if (rounds.phase === 'live') {
    hud.setHint('Bawa perangkat ke Dermaga atau Gudang · G granat pecah · F granat asap');
  } else {
    hud.setHint('');
  }
}

function drainEvents() {
  for (const event of sim.drainEvents()) {
    if (event.type === 'shot') audio.shot(event.kind);
    else if (event.type === 'dry') audio.dryClick();
    else if (event.type === 'reload') audio.reload();
    else if (event.type === 'throw') audio.throwWhoosh();
    else if (event.type === 'hit') audio.hit(event.killed);
    else if (event.type === 'hurt') {
      audio.hurt();
      hud.flashDamage();
    } else if (event.type === 'kill') hud.addKill(event.text);
    else if (event.type === 'playerDied') hud.addKill(`${event.cause} ▸ KAMU`);
    else if (event.type === 'explosion') audio.explosion();
    else if (event.type === 'planted') {
      audio.plant();
      hud.showBanner('PERANGKAT TERPASANG', `Site ${event.site} — meledak ${event.detonateIn} detik. Bertahan!`);
      hud.setBomb(`Perangkat aktif di Site ${event.site}`);
    } else if (event.type === 'bought') {
      hud.showBanner('DIBELI', `${event.name} — sisa $${event.money}`, 1200);
    } else if (event.type === 'roundStart') {
      hud.showBanner(`RONDE ${event.round}`, 'ELANG menyerang · KOMODO bertahan');
      buyVisible = false;
      hud.showBuy(false);
    } else if (event.type === 'newRound') {
      buyVisible = true;
      refreshBuyMenu();
    } else if (event.type === 'roundEnd') {
      if (event.winner === 'elang') audio.roundWin();
      else audio.roundLose();
      hud.showBanner(
        event.winner === 'elang' ? 'ELANG MENANG' : 'KOMODO MENANG',
        `${event.reason} · ${event.score.elang} — ${event.score.komodo}`,
        4200,
      );
      buyVisible = false;
      hud.showBuy(false);
    } else if (event.type === 'matchEnd') {
      hud.showBanner(
        event.winner === 'elang' ? 'ELANG JUARA' : 'KOMODO JUARA',
        `Skor akhir ${event.score.elang} — ${event.score.komodo}`,
        60000,
      );
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  const look = input.takeLook();
  sim.player.look(look.x, look.y);
  const simInput = input.input;
  simInput.firePressed = input.consumeFirePressed();
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    sim.step(FIXED_STEP, simInput);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;
  syncCamera();
  drainEvents();
  syncHud();
  const stepCount = Math.floor(body.walkTime / 2.4);
  if (stepCount !== lastStepCount) {
    lastStepCount = stepCount;
    if (body.alive && body.onGround) audio.step();
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) {
  shots.runShot(shot, renderer, scene);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
