// The bots: 3 ELANG teammates and 4 KOMODO defenders. Each bot walks the waypoint
// graph, holds angles, reacts to what it sees and hears, and shoots back with
// distance-based aim error. Attackers push a site and plant; defenders hold sites
// and defuse. Bots never teleport and never see through walls: sight is a real
// raycast against the map, and smoke blocks it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { SPAWNS } from './world.js';
import { range } from './rng.js';

const BOT_HEALTH = 100;
const BOT_SPEED = 3.6;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE_HEIGHT = 1.52;
const SIGHT_RANGE = 28;
const SIGHT_HALF_FOV = 1.05;
const SENSE_TICK = 0.15;
const BURST_MIN = 3;
const BURST_MAX = 6;

const NAMES = {
  elang: ['BAYU', 'SINTA', 'DEWA'],
  komodo: ['AGUS', 'RINA', 'JOKO', 'PUTRI'],
};

const SITE_NODE = { A: 5, B: 8 };
// Attackers stage on a covering angle near the target site, in pairs with the carrier.
const COVER_NODES = { A: [4, 6], B: [7, 9] };
// One fixed site angle per defender: two anchors on the sites, two on the flanks.
const KOMODO_HOLDS = [5, 14, 8, 15];
// Long-range fights: shorter bursts, longer pauses, wider aim error.
const BURST_LONG_MIN = 2;
const BURST_LONG_MAX = 3;

function bfs(nodes, from, to) {
  if (from === to) return [to];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const current = queue.shift();
    for (let i = 3; i < nodes[current].length; i += 1) {
      const next = nodes[current][i];
      if (prev[next] !== -1) continue;
      prev[next] = current;
      if (next === to) {
        const path = [to];
        let node = to;
        while (node !== from) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i][0] - x;
    const dz = nodes[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function createBots(scene, world, rng) {
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
  const elangMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.elang), roughness: 0.7 });
  const komodoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.komodo), roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262b'), roughness: 0.85 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f45'), roughness: 0.45, metalness: 0.6 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.18, 0.62, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);
  const helmetGeo = new THREE.BoxGeometry(0.34, 0.12, 0.34);

  const bots = [];
  const eyeScratch = new THREE.Vector3();
  const targetScratch = new THREE.Vector3();
  const dirScratch = new THREE.Vector3();

  function makeBot(team, index, spawn) {
    const group = new THREE.Group();
    const mat = team === 'elang' ? elangMat : komodoMat;
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 1.02;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.56;
    head.userData.part = 'head';
    const helmet = new THREE.Mesh(helmetGeo, darkMat);
    helmet.position.y = 1.66;
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.13, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.13, 0.31, 0);
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.2, 1.08, -0.3);
    group.add(torso, head, helmet, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
      }
    });
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);

    const bot = {
      id: `${team}-${index}`,
      team,
      name: NAMES[team][index],
      group,
      torso,
      head,
      position: group.position,
      velocity: new THREE.Vector3(),
      yaw: team === 'elang' ? 0 : Math.PI,
      health: BOT_HEALTH,
      alive: true,
      fall: 0,
      mode: 'advance',
      path: [],
      pathIndex: 0,
      holdNode: team === 'komodo' ? KOMODO_HOLDS[index] : null,
      holdUntil: 0,
      target: null,
      lastSeen: new THREE.Vector3(),
      lastSeenAt: -99,
      investigate: null,
      investigateAt: -99,
      senseAt: range(rng, 0, SENSE_TICK),
      burstLeft: 0,
      shootAt: 0,
      aimError: 0.02,
      walkPhase: range(rng, 0, 6),
      carrier: false,
      planting: 0,
      defusing: 0,
      speed: BOT_SPEED * range(rng, 0.9, 1.1),
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  function spawnAll() {
    bots.length = 0;
    for (let i = 0; i < 3; i += 1) makeBot('elang', i, SPAWNS.elang[i]);
    for (let i = 0; i < 4; i += 1) makeBot('komodo', i, SPAWNS.komodo[i]);
    bots[0].carrier = true;
  }

  spawnAll();

  function setPath(bot, goalNode) {
    const from = nearestNode(world.nodes, bot.position.x, bot.position.z);
    bot.path = bfs(world.nodes, from, goalNode);
    bot.pathIndex = 0;
  }

  function pickObjective(bot, objective) {
    if (bot.team === 'elang') {
      if (bot.carrier) {
        setPath(bot, SITE_NODE[objective.site]);
        bot.mode = 'advance';
      } else if (bot.mode !== 'engage') {
        // Escort: push with the carrier toward the same site and hold a
        // covering angle near it instead of wandering to mid.
        const cover = COVER_NODES[objective.site];
        const slot = Number(bot.id.split('-')[1]) % cover.length;
        setPath(bot, cover[slot]);
        bot.mode = 'advance';
      }
    } else if (bot.mode !== 'engage') {
      // Defenders stick to their assigned site angle for the whole round.
      setPath(bot, bot.holdNode);
      bot.mode = 'advance';
    }
  }

  function visibleEnemy(bot, player, others, smokeZones) {
    // Returns { kind: 'player'|'bot', ref, point, dist } or null.
    let best = null;
    let bestDist = Infinity;
    const candidates = [];
    if (player.state.alive) candidates.push({ kind: 'player', ref: player, point: player.state.position });
    for (const other of others) {
      if (other.team !== bot.team && other.alive) candidates.push({ kind: 'bot', ref: other, point: other.position });
    }
    eyeScratch.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    for (const cand of candidates) {
      const p = cand.point;
      targetScratch.set(p.x, p.y + 1.2, p.z);
      dirScratch.copy(targetScratch).sub(eyeScratch);
      const dist = dirScratch.length();
      if (dist > SIGHT_RANGE || dist < 0.5) continue;
      if (dist > 14) {
        const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
        const dot = dirScratch.normalize().dot(forward);
        if (dot < Math.cos(SIGHT_HALF_FOV)) continue;
      }
      if (!world.hasLineOfSight(eyeScratch, targetScratch, smokeZones)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = { kind: cand.kind, ref: cand.ref, point: targetScratch.clone(), dist };
      }
    }
    return best;
  }

  function step(dt, ctx) {
    const { player, smokeZones, objective, now, onBotShot } = ctx;
    // Freeze time: bots hold still until the round goes live.
    if (objective.phase !== 'live') return;
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.45);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.1;
        }
        continue;
      }
      bot.senseAt -= dt;
      if (bot.senseAt <= 0) {
        bot.senseAt = SENSE_TICK;
        const seen = visibleEnemy(bot, player, bots, smokeZones);
        if (seen) {
          const fresh = bot.mode !== 'engage';
          bot.target = seen;
          bot.lastSeen.copy(seen.point);
          bot.lastSeenAt = now;
          bot.mode = 'engage';
          bot.aimError = seen.dist > 20 ? 0.016 + seen.dist * 0.0022 : 0.012 + seen.dist * 0.0016;
          // First sight of a target: the bot needs a beat to aim in.
          if (fresh) bot.shootAt = Math.max(bot.shootAt, now + 0.35);
        } else if (bot.mode === 'engage' && now - bot.lastSeenAt > 2.5) {
          bot.target = null;
          bot.mode = 'advance';
          if (bot.investigate && now - bot.investigateAt < 8) {
            setPath(bot, nearestNode(world.nodes, bot.investigate.x, bot.investigate.z));
          } else {
            pickObjective(bot, objective);
          }
        }
      }

      // Bomb duties outrank wandering.
      if (objective.bombPlanted && bot.team === 'komodo' && bot.mode !== 'engage') {
        if (bot.defusing <= 0) {
          const site = objective.bombSite === 'A' ? 5 : 8;
          if (nearestNode(world.nodes, bot.position.x, bot.position.z) !== site) setPath(bot, site);
          bot.mode = 'defuse';
        }
      }
      if (bot.carrier && !objective.bombPlanted && bot.mode !== 'engage' && objective.phase === 'live') {
        const siteNode = SITE_NODE[objective.site];
        const atSite = world.siteAt(bot.position.x, bot.position.z) === objective.site;
        if (atSite) {
          bot.planting += dt;
          bot.mode = 'plant';
          if (bot.planting >= 3) {
            bot.planting = 0;
            ctx.onPlant(bot);
          }
        } else if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) {
          setPath(bot, siteNode);
          bot.mode = 'advance';
        }
      }
      if (bot.mode === 'defuse' && objective.bombPlanted) {
        const atSite = world.siteAt(bot.position.x, bot.position.z) === objective.bombSite;
        if (atSite) {
          bot.defusing += dt;
          if (bot.defusing >= 5) {
            bot.defusing = 0;
            ctx.onDefuse(bot);
          }
        }
      }

      // Movement.
      bot.velocity.set(0, 0, 0);
      let moving = false;
      if (bot.mode === 'engage' && bot.target) {
        const dx = bot.lastSeen.x - bot.position.x;
        const dz = bot.lastSeen.z - bot.position.z;
        const dist = Math.hypot(dx, dz);
        bot.yaw = Math.atan2(-dx, -dz);
        if (dist > 9) {
          bot.velocity.set(-Math.sin(bot.yaw) * bot.speed, 0, -Math.cos(bot.yaw) * bot.speed);
          moving = true;
        } else if (dist < 4) {
          bot.velocity.set(Math.sin(bot.yaw) * bot.speed * 0.5, 0, Math.cos(bot.yaw) * bot.speed * 0.5);
          moving = true;
        }
      } else if (bot.path.length > 0 && bot.pathIndex < bot.path.length) {
        const node = world.nodes[bot.path[bot.pathIndex]];
        const dx = node[0] - bot.position.x;
        const dz = node[1] - bot.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.9) {
          bot.pathIndex += 1;
        } else {
          const targetYaw = Math.atan2(-dx, -dz);
          let dyaw = targetYaw - bot.yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
          const speed = bot.mode === 'defuse' ? bot.speed * 1.15 : bot.speed;
          bot.velocity.set(-Math.sin(bot.yaw) * speed, 0, -Math.cos(bot.yaw) * speed);
          moving = true;
        }
      } else if (bot.mode === 'advance') {
        // Site defenders hold their angle much longer than attackers staging.
        const longHold = bot.team === 'komodo' && bot.holdNode !== null;
        bot.holdUntil = now + (longHold ? range(rng, 6, 12) : range(rng, 2, 5));
        bot.mode = 'hold';
      }
      if (bot.mode === 'hold') {
        bot.yaw += Math.sin(now * 0.4 + bot.walkPhase) * dt * 0.5;
        if (now >= bot.holdUntil) pickObjective(bot, objective);
      }
      bot.velocity.y = -0.5;
      world.moveBox(bot.position, bot.velocity, dt, BOT_RADIUS, BOT_HEIGHT);
      bot.group.rotation.y = bot.yaw;
      if (moving) {
        bot.walkPhase += dt * 7;
        bot.group.children[3].rotation.x = Math.sin(bot.walkPhase) * 0.5;
        bot.group.children[4].rotation.x = -Math.sin(bot.walkPhase) * 0.5;
      }

      // Shooting: bursts with a pause, error grows with distance and movement.
      // Long-range targets get shorter bursts and longer pauses, so a still
      // player at ~25 m is not melted the moment a bot sees them.
      if (bot.mode === 'engage' && bot.target && now >= bot.shootAt) {
        const longRange = bot.target.dist > 20;
        if (bot.burstLeft <= 0) {
          bot.burstLeft = longRange
            ? BURST_LONG_MIN + Math.floor(rng() * (BURST_LONG_MAX - BURST_LONG_MIN + 1))
            : BURST_MIN + Math.floor(rng() * (BURST_MAX - BURST_MIN + 1));
          bot.shootAt = now + (longRange ? range(rng, 1.4, 2.4) : range(rng, 0.8, 1.4));
        } else {
          bot.burstLeft -= 1;
          bot.shootAt = now + 0.16;
          const err = bot.aimError * (moving ? 1.6 : 1);
          const ox = bot.lastSeen.x + (rng() * 2 - 1) * err * bot.target.dist * 2;
          const oy = bot.lastSeen.y + (rng() * 2 - 1) * err * bot.target.dist * 2;
          const oz = bot.lastSeen.z + (rng() * 2 - 1) * err * bot.target.dist * 2;
          const muzzle = new THREE.Vector3(bot.position.x, bot.position.y + 1.35, bot.position.z);
          onBotShot(bot, muzzle, new THREE.Vector3(ox, oy, oz), bot.target);
        }
      }
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.target = null;
    return true;
  }

  function hearNoise(point, now) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      // Defenders holding a site angle ignore distant noise.
      if (bot.team === 'komodo' && bot.holdNode !== null && bot.mode === 'hold') continue;
      const dx = bot.position.x - point.x;
      const dz = bot.position.z - point.z;
      if (dx * dx + dz * dz < 18 * 18) {
        bot.investigate = { x: point.x, z: point.z };
        bot.investigateAt = now;
      }
    }
  }

  function reset(spawns) {
    let ei = 0;
    let ki = 0;
    for (const bot of bots) {
      const spawn = bot.team === 'elang' ? SPAWNS.elang[ei++] : SPAWNS.komodo[ki++];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.velocity.set(0, 0, 0);
      bot.yaw = bot.team === 'elang' ? 0 : Math.PI;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.fall = 0;
      bot.mode = 'advance';
      bot.path = [];
      bot.pathIndex = 0;
      bot.target = null;
      bot.planting = 0;
      bot.defusing = 0;
      bot.burstLeft = 0;
      bot.carrier = bot.id === 'elang-0';
    }
  }

  function aliveCount(team) {
    let count = 0;
    for (const bot of bots) if (bot.team === team && bot.alive) count += 1;
    return count;
  }

  function hitMeshes() {
    const list = [];
    for (const bot of bots) {
      if (bot.alive) list.push(bot.torso, bot.head);
    }
    return list;
  }

  return {
    bots,
    step,
    damage,
    hearNoise,
    reset,
    aliveCount,
    hitMeshes,
    pickObjective,
    setPath,
  };
}
