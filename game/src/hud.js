// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// buy menu, round banners and the start/pause/end overlays. It never touches the
// simulation; the main loop pushes numbers in and reads the play callback out.
// Writes are cached so the DOM is only touched when a value actually changes.
const COPY = {
  start: {
    title: 'SENJA HARBOR',
    copy: 'Pelabuhan kontainer saat senja. ELANG menyerang, KOMODO bertahan. Pasang perangkat di Dermaga atau Gudang — atau habisi semua lawan.',
    action: 'Klik untuk bermain',
  },
  paused: {
    title: 'SENJA HARBOR',
    copy: 'Jeda. Klik untuk lanjut.',
    action: 'Lanjut bermain',
  },
  roundEnd: {
    title: 'Ronde selesai',
    copy: '',
    action: 'Lanjut',
  },
  matchEnd: {
    title: 'Pertandingan selesai',
    copy: '',
    action: 'Main lagi',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeLine = $('grenades');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreElang = $('score-elang');
  const scoreKomodo = $('score-komodo');
  const aliveElang = $('alive-elang');
  const aliveKomodo = $('alive-komodo');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const damage = $('damage');
  const hint = $('hint');
  const bombStatus = $('bomb-status');
  const scope = $('scope');

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(value) {
      setText(healthNum, 'hp', String(value));
      if (last.hpf !== value) {
        last.hpf = value;
        healthFill.style.width = `${value}%`;
        healthFill.classList.toggle('low', value <= 30);
      }
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
    },
    setGrenades(frag, smoke) {
      setText(grenadeLine, 'nades', `Granat: ${frag} pecah · ${smoke} asap  [G / F]`);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
    },
    setTimer(seconds) {
      const total = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      timerValue.classList.toggle('urgent', total <= 10);
    },
    setScore(elang, komodo) {
      setText(scoreElang, 'se', String(elang));
      setText(scoreKomodo, 'sk', String(komodo));
    },
    setAlive(elang, komodo) {
      setText(aliveElang, 'ae', '●'.repeat(Math.max(0, elang)));
      setText(aliveKomodo, 'ak', '●'.repeat(Math.max(0, komodo)));
    },
    setCrosshair(gapPx) {
      const gap = Math.round(gapPx);
      if (last.gap === gap) return;
      last.gap = gap;
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    setScope(on) {
      // Sniper scope: dark ring around the view, crosshair hidden.
      scope.classList.toggle('on', !!on);
      crosshair.style.visibility = on ? 'hidden' : 'visible';
    },
    hitMarker(killed, holdMs = 120) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    flashDamage() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    addKill(text) {
      const line = document.createElement('div');
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    setBomb(text) {
      setText(bombStatus, 'bomb', text);
    },
    setPlant(label, progress) {
      if (progress <= 0 && label === '') {
        plantBar.classList.add('hidden');
        return;
      }
      plantBar.classList.remove('hidden');
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    setHint(text) {
      setText(hint, 'hint', text);
    },
    buildBuyMenu(items, onBuy) {
      buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.disabled;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-price">${item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyList.appendChild(row);
      }
    },
    showBuy(open) {
      buyMenu.classList.toggle('hidden', !open);
    },
    showOverlay(mode, detail = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'roundEnd' || mode === 'matchEnd' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      if (mode === 'start') play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
