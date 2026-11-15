// Rounds and the economy: buy phase, live round, round end, match end. Money is
// earned per kill, per round win and per plant, and spent in the buy menu. The bomb
// is carried by the player or the carrier bot, planted at a site, and either
// detonates or gets defused. First to 5 rounds takes the match.
import { WEAPONS, GRENADES } from './weapon.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const END_TIME = 5;
export const WIN_ROUNDS = 5;
export const BOMB_TIMER = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;

const KILL_REWARD = 300;
const WIN_REWARD = 2700;
const LOSS_REWARD = 1900;
const PLANT_REWARD = 300;
const START_MONEY = 800;

export function createRounds(weapon) {
  const state = {
    round: 1,
    score: { elang: 0, komodo: 0 },
    phase: 'buy',
    phaseTime: 0,
    timer: BUY_TIME,
    money: START_MONEY,
    bomb: { holder: 'player', site: 'A', planted: false, siteKey: null, plantProgress: 0, defuseProgress: 0, detonateIn: 0, droppedAt: null },
    winner: null,
    reason: '',
    matchOver: false,
    buyOpen: true,
  };

  function startRound() {
    state.phase = 'buy';
    state.phaseTime = 0;
    state.timer = BUY_TIME;
    state.buyOpen = true;
    state.bomb = { holder: 'player', site: 'A', planted: false, siteKey: null, plantProgress: 0, defuseProgress: 0, detonateIn: 0, droppedAt: null };
    state.winner = null;
    state.reason = '';
  }

  function endRound(winner, reason, events) {
    if (state.phase === 'end') return;
    state.phase = 'end';
    state.phaseTime = 0;
    state.timer = END_TIME;
    state.winner = winner;
    state.reason = reason;
    state.buyOpen = false;
    state.score[winner] += 1;
    if (winner === 'elang') state.money += WIN_REWARD;
    else state.money += LOSS_REWARD;
    events.push({ type: 'roundEnd', winner, reason, score: { ...state.score }, round: state.round });
    if (state.score[winner] >= WIN_ROUNDS) {
      state.matchOver = true;
      events.push({ type: 'matchEnd', winner, score: { ...state.score } });
    }
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function buy(id, events) {
    if (!state.buyOpen) return false;
    if (WEAPONS[id]) {
      const def = WEAPONS[id];
      if (weapon.state.owned.includes(id)) return false;
      if (state.money < def.price) return false;
      state.money -= def.price;
      weapon.buyGun(id);
      weapon.refillAmmo(id);
      weapon.equip(id);
      events.push({ type: 'bought', name: def.name, money: state.money });
      return true;
    }
    if (GRENADES[id]) {
      const def = GRENADES[id];
      if (state.money < def.price) return false;
      state.money -= def.price;
      weapon.addGrenade(id);
      events.push({ type: 'bought', name: def.name, money: state.money });
      return true;
    }
    return false;
  }

  function step(dt, ctx, events) {
    state.phaseTime += dt;
    if (state.phase === 'buy') {
      state.timer = Math.max(0, BUY_TIME - state.phaseTime);
      if (state.phaseTime >= BUY_TIME) {
        state.phase = 'live';
        state.phaseTime = 0;
        state.timer = ROUND_TIME;
        state.buyOpen = false;
        events.push({ type: 'roundStart', round: state.round });
      }
      return;
    }
    if (state.phase === 'live') {
      state.timer = Math.max(0, ROUND_TIME - state.phaseTime);
      if (state.bomb.planted) {
        state.bomb.detonateIn -= dt;
        if (state.bomb.detonateIn <= 0) {
          endRound('elang', 'Perangkat meledak di Site ' + state.bomb.siteKey, events);
          return;
        }
      }
      const elangAlive = ctx.elangAlive;
      const komodoAlive = ctx.komodoAlive;
      if (elangAlive === 0 && !state.bomb.planted) {
        endRound('komodo', 'Tim ELANG habis', events);
        return;
      }
      if (elangAlive === 0 && state.bomb.planted) {
        // Round continues until detonation or defuse.
        return;
      }
      if (komodoAlive === 0 && !state.bomb.planted) {
        endRound('elang', 'Tim KOMODO habis', events);
        return;
      }
      if (komodoAlive === 0 && state.bomb.planted) {
        return;
      }
      if (state.timer <= 0 && !state.bomb.planted) {
        endRound('komodo', 'Waktu habis — perangkat tidak terpasang', events);
      }
      return;
    }
    if (state.phase === 'end') {
      state.timer = Math.max(0, END_TIME - state.phaseTime);
      if (state.phaseTime >= END_TIME && !state.matchOver) {
        nextRound();
        events.push({ type: 'newRound', round: state.round });
      }
    }
  }

  function plantBomb(siteKey, events) {
    state.bomb.planted = true;
    state.bomb.siteKey = siteKey;
    state.bomb.detonateIn = BOMB_TIMER;
    state.bomb.plantProgress = 0;
    state.money += PLANT_REWARD;
    events.push({ type: 'planted', site: siteKey, detonateIn: BOMB_TIMER });
  }

  function defuseBomb(events) {
    state.bomb.planted = false;
    endRound('komodo', 'Perangkat dijinakkan', events);
  }

  function onKill(killerTeam, events) {
    if (killerTeam === 'elang') {
      state.money += KILL_REWARD;
      events.push({ type: 'money', money: state.money });
    }
  }

  return {
    state,
    step,
    buy,
    plantBomb,
    defuseBomb,
    onKill,
    startRound,
    endRound,
  };
}
