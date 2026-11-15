// The player body: acceleration, friction, gravity, crouch and jump, moved through
// the world's shared box mover one axis at a time. Health lives here too; damage
// and healing are plain functions the simulation calls, never DOM code.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const ADS_SPEED = 3.1;
const GROUND_ACCEL = 44;
const AIR_ACCEL = 10;
const FRICTION = 9.5;
const GRAVITY = 21;
const JUMP_SPEED = 6.4;
const MAX_HEALTH = 100;

export function createPlayer(world, spawn) {
  const state = {
    position: new THREE.Vector3(spawn[0], 0, spawn[1]),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    onGround: true,
    crouching: false,
    aiming: false,
    health: MAX_HEALTH,
    alive: true,
    walkTime: 0,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0021) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && state.crouching) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);
    state.aiming = keys.has('ShiftLeft') || keys.has('ShiftRight');

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = state.crouching ? CROUCH_SPEED : state.aiming ? ADS_SPEED : WALK_SPEED;
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (keys.has('Space') && state.onGround && !state.crouching) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    state.velocity.y = Math.max(-32, state.velocity.y);

    state.onGround = world.moveBox(state.position, state.velocity, dt, RADIUS, state.height);
    const groundSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    if (state.onGround && groundSpeed > 1) state.walkTime += dt * groundSpeed;
  }

  function damage(amount) {
    if (!state.alive) return false;
    state.health = Math.max(0, state.health - amount);
    if (state.health === 0) {
      state.alive = false;
      return true;
    }
    return false;
  }

  function reset(spawnPoint) {
    state.position.set(spawnPoint[0], 0, spawnPoint[1]);
    state.velocity.set(0, 0, 0);
    state.yaw = 0;
    state.pitch = 0;
    state.health = MAX_HEALTH;
    state.alive = true;
    state.crouching = false;
    state.height = STAND_HEIGHT;
    state.eye = STAND_EYE;
  }

  return {
    state,
    step,
    look,
    recoil,
    damage,
    reset,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    eyePosition(out) {
      out.set(state.position.x, state.position.y + state.eye, state.position.z);
      return out;
    },
  };
}
