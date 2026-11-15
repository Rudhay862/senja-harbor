// Deterministic captures: ?shot=start|play|end with &seed=N stages one frozen
// frame of the real game, renders it twice, then sets window.__shotReady so a
// screenshot tool knows the frame is settled. The staged scenes use the same
// simulation the player plays — nothing here is a mock or a backdrop.
//   start: spawn view at dusk, buy menu open, the harbor ahead.
//   play:  mid-combat on the mid lane — bots in sight, a shot fired, tracer live.
//   end:   round won at Site Dermaga, banner up, score on the HUD.
import * as THREE from 'three';

const STEP = 1 / 60;

export function createShots(sim, hud, camera, world) {
  const player = sim.player;
  const body = player.state;
  const aimPoint = new THREE.Vector3();

  function syncCamera() {
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  }

  function settle(steps, input) {
    for (let i = 0; i < steps; i += 1) {
      sim.step(STEP, input);
    }
  }

  function idleInput() {
    return { keys: new Set(), firing: false, firePressed: false, grenade: null, buyId: null, switchTo: null };
  }

  function aimAt(point) {
    const dx = point.x - body.position.x;
    const dy = point.y - (body.position.y + body.eye);
    const dz = point.z - body.position.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    body.yaw = Math.atan2(-dx, -dz);
    body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
    syncCamera();
  }

  function runShot(name, renderer, scene) {
    hud.hideOverlay();
    // Tracers live longer in staged captures so the play shot shows gunfire.
    sim.setShotMode(true);
    sim.resetMatch();
    const input = idleInput();
    if (name === 'start') {
      body.position.set(0, 0, 16);
      body.yaw = 0;
      body.pitch = 0.02;
      settle(30, input);
      aimAt(new THREE.Vector3(-6, 1.4, -12));
      hud.buildBuyMenu(sim.buildBuyItems(), () => {});
      hud.showBuy(true);
      hud.setHint('Fase beli — pilih senjata, lalu klik untuk bermain');
      hud.setMoney(sim.rounds.state.money);
      hud.setTimer(sim.rounds.state.timer);
      hud.setScore(0, 0);
      hud.setAlive(4, 4);
      hud.setHealth(100);
      hud.setAmmo(30, 90, 'AR-7 Kijang');
      hud.setGrenades(1, 0);
      hud.setBomb('Perangkat ada padamu — pasang di Dermaga / Gudang');
    } else if (name === 'play') {
      // Skip the buy phase, put the player mid-lane with enemies ahead.
      sim.rounds.state.phase = 'live';
      sim.rounds.state.phaseTime = 0;
      sim.rounds.state.timer = 73;
      body.position.set(0, 0, 6);
      body.yaw = 0;
      body.pitch = 0;
      const bots = sim.bots.bots;
      bots[3].position.set(-3, 0, -6);
      bots[3].yaw = Math.PI;
      bots[4].position.set(4, 0, -10);
      bots[4].yaw = Math.PI;
      bots[5].position.set(-9, 0, -4);
      bots[5].yaw = Math.PI * 0.8;
      bots[0].position.set(-4, 0, 10);
      bots[1].position.set(5, 0, 12);
      settle(10, input);
      aimPoint.set(bots[3].position.x, bots[3].position.y + 1.2, bots[3].position.z);
      aimAt(aimPoint);
      const fireInput = idleInput();
      fireInput.firing = true;
      fireInput.firePressed = true;
      sim.step(STEP, fireInput);
      settle(6, input);
      aimAt(aimPoint);
      hud.setHealth(100);
      hud.setAmmo(sim.weapon.ammo.rifle.mag, sim.weapon.ammo.rifle.reserve, 'AR-7 Kijang');
      hud.setGrenades(1, 0);
      hud.setMoney(1100);
      hud.setTimer(73);
      hud.setScore(1, 0);
      hud.setAlive(4, 3);
      hud.setBomb('Perangkat ada padamu — pasang di Dermaga / Gudang');
      hud.setHint('Musuh di depan — tahan Shift untuk membidik');
      hud.hitMarker(false, 4000);
    } else {
      // Round won: banner up, bomb gone off at Dermaga, score on the board.
      sim.rounds.state.phase = 'end';
      sim.rounds.state.phaseTime = 0;
      sim.rounds.state.score = { elang: 3, komodo: 1 };
      sim.rounds.state.round = 4;
      sim.rounds.state.winner = 'elang';
      sim.rounds.state.reason = 'Perangkat meledak di Site Dermaga';
      body.position.set(-12, 0, -6);
      body.yaw = 0;
      body.pitch = 0;
      const bots = sim.bots.bots;
      bots[3].alive = false;
      bots[3].fall = 1;
      bots[3].group.rotation.x = -1.5;
      bots[4].position.set(2, 0, -14);
      bots[4].yaw = Math.PI;
      settle(8, input);
      aimAt(new THREE.Vector3(-20, 1, -13));
      hud.setHealth(62);
      hud.setAmmo(17, 90, 'AR-7 Kijang');
      hud.setGrenades(0, 0);
      hud.setMoney(3800);
      hud.setTimer(5);
      hud.setScore(3, 1);
      hud.setAlive(2, 0);
      hud.setBomb('Site Dermaga — perangkat meledak');
      hud.showBanner('ELANG MENANG', 'Perangkat meledak di Site Dermaga · Ronde 4 · 3 — 1', 60000);
    }
    syncCamera();
    // Two real renders, then the frame is ready for capture.
    let painted = 0;
    function paint() {
      requestAnimationFrame(paint);
      syncCamera();
      renderer.render(scene, camera);
      painted += 1;
      if (painted === 2) window.__shotReady = true;
    }
    requestAnimationFrame(paint);
  }

  return { runShot, syncCamera };
}
