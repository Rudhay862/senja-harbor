// The simulation: one state store, one fixed 60 Hz step. It wires the player, the
// weapons, the bots, the rounds, the grenades, the tracers and the bomb together.
// Rendering lives in main.js; this file never touches the DOM or the camera. All
// visible effects (tracers, explosions, smoke) are preallocated pools, so the hot
// loop allocates nothing.
import * as THREE from 'three';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { SITES } from './world.js';

const TRACER_POOL = 24;
const TRACER_LIFE = 0.07;
const TRACER_LIFE_SHOT = 0.6;
const BOT_DAMAGE = 16;
const BOT_VS_BOT_DAMAGE = 16;
const GRENADE_SPEED = 13;

export function createSim(scene, camera, world, rng) {
  const weapon = createWeapon(camera);
  const rounds = createRounds(weapon);
  const player = createPlayer(world, [0, 16]);
  const bots = createBots(scene, world, rng);

  const events = [];
  const state = {
    time: 0,
    playerDied: false,
    plantProgress: 0,
    defuseProgress: 0,
    bombSiteTarget: 'A',
  };

  // Tracer pool: 24 reusable lines.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0, max: TRACER_LIFE });
  }
  let tracerIndex = 0;
  let shotMode = false;

  // Explosion flash: one sphere and one light, reused.
  const blastMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa03d, transparent: true, opacity: 0, depthWrite: false }),
  );
  blastMesh.visible = false;
  scene.add(blastMesh);
  const blastLight = new THREE.PointLight(0xff9a3d, 0, 18, 2);
  scene.add(blastLight);
  let blastLife = 0;

  // Bomb device mesh: shown while planted, blinking.
  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.34), new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 }));
  const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  bombLight.position.set(0.18, 0.18, 0);
  bombMesh.add(bombBody, bombLight);
  bombMesh.visible = false;
  scene.add(bombMesh);

  const grenades = [];
  const smokeZones = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.6, metalness: 0.4 });
  const smokeGeo = new THREE.SphereGeometry(1, 14, 10);
  const eyeScratch = new THREE.Vector3();
  const dirScratch = new THREE.Vector3();
  const aimScratch = new THREE.Vector3();
  const muzzleScratch = new THREE.Vector3();

  function spawnTracer(a, b, color = 0xffc46b) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const pos = tracer.line.geometry.attributes.position.array;
    pos[0] = a.x; pos[1] = a.y; pos[2] = a.z;
    pos[3] = b.x; pos[4] = b.y; pos[5] = b.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.color.setHex(color);
    tracer.line.material.opacity = 0.9;
    tracer.line.visible = true;
    // Staged captures hold the tracer so a screenshot can show gunfire;
    // live play keeps the short snap.
    tracer.life = shotMode ? TRACER_LIFE_SHOT : TRACER_LIFE;
    tracer.max = tracer.life;
  }

  function explode(center, kind) {
    blastMesh.position.copy(center);
    blastMesh.scale.setScalar(0.5);
    blastMesh.visible = true;
    blastLife = 0.35;
    blastLight.position.copy(center);
    blastLight.intensity = 60;
    events.push({ type: 'explosion', x: center.x, y: center.y, z: center.z });
    if (kind === 'frag') {
      const radius = 6.5;
      const hurt = (pos, health) => {
        const dx = pos.x - center.x;
        const dy = (pos.y + 1.1) - center.y;
        const dz = pos.z - center.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > radius) return 0;
        return Math.round(105 * (1 - dist / radius) + 10);
      };
      if (player.state.alive) {
        const dmg = hurt(player.state.position);
        if (dmg > 0 && player.damage(dmg)) onPlayerDeath('ledakan');
        else if (dmg > 0) events.push({ type: 'hurt', amount: dmg });
      }
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const dmg = hurt(bot.position);
        if (dmg > 0 && bots.damage(bot, dmg)) onBotDeath(bot, 'ledakan');
      }
    }
  }

  function addSmoke(center) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9aa5a8, transparent: true, opacity: 0.5, depthWrite: false });
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.position.set(center.x, center.y + 1.2, center.z);
    mesh.scale.setScalar(4.5);
    scene.add(mesh);
    const zone = {
      center: new THREE.Vector3(center.x, center.y + 1.2, center.z),
      radius: 4.5,
      until: state.time + 14,
      mesh,
      blocks(a, b) {
        // Segment-sphere test: does segment ab pass through this smoke ball?
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const acx = this.center.x - a.x;
        const acy = this.center.y - a.y;
        const acz = this.center.z - a.z;
        const lenSq = abx * abx + aby * aby + abz * abz;
        let t = lenSq > 0 ? (acx * abx + acy * aby + acz * abz) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = a.x + abx * t - this.center.x;
        const dy = a.y + aby * t - this.center.y;
        const dz = a.z + abz * t - this.center.z;
        return dx * dx + dy * dy + dz * dz < this.radius * this.radius;
      },
    };
    smokeZones.push(zone);
  }

  function throwGrenade(kind) {
    if (!weapon.useGrenade(kind)) return false;
    player.eyePosition(eyeScratch);
    const yaw = player.state.yaw;
    const pitch = player.state.pitch;
    dirScratch.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.castShadow = true;
    scene.add(mesh);
    const vel = new THREE.Vector3(
      dirScratch.x * GRENADE_SPEED + player.state.velocity.x * 0.4,
      dirScratch.y * GRENADE_SPEED + 3.5,
      dirScratch.z * GRENADE_SPEED + player.state.velocity.z * 0.4,
    );
    grenades.push({ pos: eyeScratch.clone(), vel, kind, fuse: kind === 'frag' ? 1.6 : 1.1, mesh });
    events.push({ type: 'throw' });
    return true;
  }

  function onPlayerDeath(cause) {
    state.playerDied = true;
    events.push({ type: 'playerDied', cause });
    const bomb = rounds.state.bomb;
    if (bomb.holder === 'player') {
      bomb.holder = 'dropped';
      bomb.droppedAt = { x: player.state.position.x, z: player.state.position.z };
      let nearest = null;
      let nearestDist = Infinity;
      for (const bot of bots.bots) {
        if (bot.team !== 'elang' || !bot.alive) continue;
        const dx = bot.position.x - player.state.position.x;
        const dz = bot.position.z - player.state.position.z;
        const d = dx * dx + dz * dz;
        if (d < nearestDist) {
          nearestDist = d;
          nearest = bot;
        }
      }
      if (nearest) {
        nearest.carrier = true;
        bomb.holder = 'bot';
      }
    }
  }

  function onBotDeath(bot, cause) {
    events.push({ type: 'kill', text: `${cause === 'player' ? 'KAMU' : cause.toUpperCase()} ▸ ${bot.name}`, team: bot.team });
    if (cause === 'player') rounds.onKill('elang', events);
    if (bot.carrier) {
      bot.carrier = false;
      const bomb = rounds.state.bomb;
      if (!bomb.planted) {
        let next = null;
        for (const other of bots.bots) {
          if (other.team === 'elang' && other.alive && other !== bot) {
            next = other;
            break;
          }
        }
        if (next) {
          next.carrier = true;
          bomb.holder = 'bot';
        } else {
          bomb.holder = 'dropped';
          bomb.droppedAt = { x: bot.position.x, z: bot.position.z };
        }
      }
    }
  }

  function fire() {
    const def = weapon.currentDef();
    if (!weapon.takeRound()) {
      events.push({ type: 'dry' });
      return false;
    }
    const spread = weapon.spread(player.groundSpeed(), player.state.aiming);
    const yaw = player.state.yaw + (rng() * 2 - 1) * spread * 2;
    const pitch = player.state.pitch + (rng() * 2 - 1) * spread * 2;
    player.eyePosition(eyeScratch);
    dirScratch.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
    // Matrices lag one render behind the simulation; refresh them so the ray
    // tests the bodies where they are now, not where they were last drawn.
    // This also makes the very first shot of a staged capture correct.
    scene.updateMatrixWorld(true);
    const hit = world.rayHit(eyeScratch, dirScratch, def.range, bots.hitMeshes());
    muzzleScratch.copy(eyeScratch).addScaledVector(dirScratch, 0.9);
    if (hit) {
      spawnTracer(muzzleScratch, hit.point);
      const bot = hit.object.userData.bot;
      if (bot && bot.alive) {
        const isHead = hit.object.userData.part === 'head';
        const dmg = Math.round(def.damage * (isHead ? def.headMult : 1));
        const killed = bots.damage(bot, dmg);
        events.push({ type: 'hit', killed, headshot: isHead });
        if (killed) onBotDeath(bot, 'player');
      } else {
        events.push({ type: 'wallHit' });
      }
    } else {
      aimScratch.copy(eyeScratch).addScaledVector(dirScratch, def.range);
      spawnTracer(muzzleScratch, aimScratch);
    }
    weapon.pullTrigger();
    player.recoil(def.kick, (rng() * 2 - 1) * def.kick * 0.4);
    bots.hearNoise(player.state.position, state.time);
    events.push({ type: 'shot', kind: def.kind });
    return true;
  }

  function onBotShot(bot, muzzle, aimPoint, target) {
    dirScratch.copy(aimPoint).sub(muzzle);
    const dist = dirScratch.length();
    dirScratch.normalize();
    const hit = world.rayHit(muzzle, dirScratch, dist + 0.5, []);
    let end = aimPoint;
    if (hit && hit.distance < dist - 0.3) end = hit.point;
    spawnTracer(muzzle, end, bot.team === 'komodo' ? 0xff7a6b : 0x7be0b8);
    if (hit && hit.distance < dist - 0.3) return;
    if (target.kind === 'player') {
      const chest = player.state.position;
      const dx = aimPoint.x - chest.x;
      const dy = aimPoint.y - (chest.y + 1.2);
      const dz = aimPoint.z - chest.z;
      if (dx * dx + dy * dy + dz * dz < 0.55 * 0.55 && player.state.alive) {
        if (player.damage(BOT_DAMAGE)) onPlayerDeath(bot.name);
        else events.push({ type: 'hurt', amount: BOT_DAMAGE, from: bot.name });
      }
    } else if (target.kind === 'bot') {
      const other = target.ref;
      if (!other.alive) return;
      const dx = aimPoint.x - other.position.x;
      const dy = aimPoint.y - (other.position.y + 1.1);
      const dz = aimPoint.z - other.position.z;
      if (dx * dx + dy * dy + dz * dz < 0.55 * 0.55) {
        if (bots.damage(other, BOT_VS_BOT_DAMAGE)) {
          onBotDeath(other, bot.name);
        }
      }
    }
  }

  function resetRoundActors() {
    player.reset([0, 16]);
    bots.reset();
    weapon.resetRound();
    state.playerDied = false;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.bombSiteTarget = rounds.state.round % 2 === 1 ? 'A' : 'B';
    bombMesh.visible = false;
    for (const zone of smokeZones) scene.remove(zone.mesh);
    smokeZones.length = 0;
    for (const g of grenades) scene.remove(g.mesh);
    grenades.length = 0;
    for (const bot of bots.bots) bots.pickObjective(bot, { site: state.bombSiteTarget, phase: 'live', bombPlanted: false });
  }

  function resetMatch() {
    rounds.state.round = 1;
    rounds.state.score = { elang: 0, komodo: 0 };
    rounds.state.money = 800;
    rounds.state.matchOver = false;
    rounds.startRound();
    resetRoundActors();
  }

  let lastRound = 1;

  function step(dt, input) {
    state.time += dt;
    const phase = rounds.state.phase;

    if (phase === 'buy' || phase === 'live') {
      player.step(dt, input.keys);
      weapon.step(dt, player.groundSpeed() > 0.5);
      if (input.firePressed || (input.firing && weapon.currentDef().auto)) {
        if (weapon.ready()) fire();
        else if (weapon.ammo[weapon.state.current].mag === 0 && weapon.state.cooldown === 0) {
          events.push({ type: 'dry' });
        }
      }
      if (input.keys.has('KeyR')) {
        if (weapon.reload()) events.push({ type: 'reload' });
      }
      if (input.grenade) {
        throwGrenade(input.grenade);
        input.grenade = null;
      }
      if (input.buyId) {
        rounds.buy(input.buyId, events);
        input.buyId = null;
      }
      if (input.switchTo) {
        // Digit keys buy in the buy phase (main.js) and switch weapons only
        // once the round is live — the two never fire on the same press.
        if (phase === 'live') weapon.equip(input.switchTo);
        input.switchTo = null;
      }

      // Player planting: hold E inside a site while carrying the device.
      const bomb = rounds.state.bomb;
      const site = world.siteAt(player.state.position.x, player.state.position.z);
      if (phase === 'live' && bomb.holder === 'player' && player.state.alive && site && input.keys.has('KeyE')) {
        state.plantProgress += dt / 3;
        if (state.plantProgress >= 1) {
          state.plantProgress = 0;
          rounds.plantBomb(site, events);
          bombMesh.position.set(SITES[site].center.x, 0.2, SITES[site].center.z);
          bombMesh.visible = true;
        }
      } else {
        state.plantProgress = Math.max(0, state.plantProgress - dt / 1.5);
      }
      // Defuse progress shown in the HUD comes from the nearest defusing bot.
      let defusing = 0;
      for (const bot of bots.bots) {
        if (bot.team === 'komodo' && bot.defusing > 0) defusing = Math.max(defusing, bot.defusing / 5);
      }
      state.defuseProgress = defusing;

      bots.step(dt, {
        player,
        smokeZones,
        objective: { site: state.bombSiteTarget, phase, bombPlanted: bomb.planted, bombSite: bomb.siteKey },
        now: state.time,
        onBotShot,
        onPlant: (bot) => {
          rounds.plantBomb(state.bombSiteTarget, events);
          bombMesh.position.set(SITES[state.bombSiteTarget].center.x, 0.2, SITES[state.bombSiteTarget].center.z);
          bombMesh.visible = true;
        },
        onDefuse: () => {
          rounds.defuseBomb(events);
          bombMesh.visible = false;
        },
      });

      // Grenades fly, bounce, then burst.
      for (let i = grenades.length - 1; i >= 0; i -= 1) {
        const g = grenades[i];
        g.fuse -= dt;
        g.vel.y -= 14 * dt;
        g.pos.addScaledVector(g.vel, dt);
        if (g.pos.y < 0.09) {
          g.pos.y = 0.09;
          g.vel.y = Math.abs(g.vel.y) * 0.35;
          g.vel.x *= 0.6;
          g.vel.z *= 0.6;
        }
        g.mesh.position.copy(g.pos);
        if (g.fuse <= 0) {
          if (g.kind === 'frag') explode(g.pos, 'frag');
          else addSmoke(g.pos);
          scene.remove(g.mesh);
          grenades.splice(i, 1);
        }
      }

      // Smoke fades out at its expiry.
      for (let i = smokeZones.length - 1; i >= 0; i -= 1) {
        const zone = smokeZones[i];
        if (state.time >= zone.until) {
          scene.remove(zone.mesh);
          smokeZones.splice(i, 1);
        }
      }
    }

    const elangAlive = (player.state.alive ? 1 : 0) + bots.aliveCount('elang');
    const komodoAlive = bots.aliveCount('komodo');
    rounds.step(dt, { elangAlive, komodoAlive }, events);
    if (rounds.state.phase === 'buy' && rounds.state.round !== lastRound) {
      lastRound = rounds.state.round;
      resetRoundActors();
    }
    if (rounds.state.phase === 'end' && rounds.state.bomb.planted && rounds.state.winner === 'elang') {
      bombMesh.visible = false;
    }

    // Tracers fade.
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / tracer.max) * 0.9;
        if (tracer.life <= 0) tracer.line.visible = false;
      }
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const k = Math.max(0, blastLife / 0.35);
      blastMesh.scale.setScalar(0.5 + (1 - k) * 6);
      blastMesh.material.opacity = k * 0.55;
      blastLight.intensity = k * 60;
      if (blastLife <= 0) {
        blastMesh.visible = false;
        blastLight.intensity = 0;
      }
    }
    if (bombMesh.visible) {
      bombLight.material.color.setHex(Math.floor(state.time * 2) % 2 === 0 ? 0xff3b30 : 0x550000);
    }
  }

  function buildBuyItems() {
    const items = [];
    const keys = ['1', '2', '3'];
    const money = rounds.state.money;
    weapon.buyOrder.forEach((id, i) => {
      const def = WEAPONS[id];
      items.push({
        id,
        key: keys[i],
        name: `${def.name} — ${def.damage} dmg · ${def.mag} peluru`,
        price: weapon.state.owned.includes(id) ? 'DIMILIKI' : `$${def.price}`,
        disabled: weapon.state.owned.includes(id) || money < def.price,
      });
    });
    items.push({
      id: 'frag', key: '4', name: 'Granat Pecah — ledakan area', price: '$300',
      disabled: money < 300,
    });
    items.push({
      id: 'smoke', key: '5', name: 'Granat Asap — blokir pandangan', price: '$250',
      disabled: money < 250,
    });
    return items;
  }

  return {
    state,
    events,
    player,
    weapon,
    bots,
    rounds,
    step,
    setShotMode(on) { shotMode = !!on; },
    fire,
    throwGrenade,
    resetMatch,
    resetRoundActors,
    buildBuyItems,
    drainEvents() {
      const out = events.splice(0, events.length);
      return out;
    },
  };
}
