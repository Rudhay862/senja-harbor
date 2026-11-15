// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain
// browser APIs only. The game also tracks fire edges (for semi-auto guns), grenade
// keys, weapon slots and the buy key, and hands them to the simulation as one
// input object per frame. Digit keys 1-4 are weapon slots during live play;
// during the buy phase main.js treats them as buy keys instead, and the
// simulation ignores switchTo until the round goes live.
export function createInput(canvas, onLockChange, onAction) {
  const keys = new Set();
  const input = {
    keys,
    firing: false,
    firePressed: false,
    grenade: null,
    buyId: null,
    switchTo: null,
    lookX: 0,
    lookY: 0,
  };

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
    if (down && onAction) onAction(event.code);
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    setKey(event, true);
    if (event.code === 'KeyG') input.grenade = 'frag';
    if (event.code === 'KeyF') input.grenade = 'smoke';
    if (event.code === 'Digit1') input.switchTo = 'rifle';
    if (event.code === 'Digit2') input.switchTo = 'smg';
    if (event.code === 'Digit3') input.switchTo = 'sniper';
    if (event.code === 'Digit4') input.switchTo = 'pistol';
  });
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    input.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== canvas) return;
    input.lookX += event.movementX;
    input.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (document.pointerLockElement === canvas && event.button === 0) {
      input.firing = true;
      input.firePressed = true;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) input.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked) {
      keys.clear();
      input.firing = false;
    }
    onLockChange(locked);
  });

  return {
    input,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = input.lookX;
      const y = input.lookY;
      input.lookX = 0;
      input.lookY = 0;
      return { x, y };
    },
    consumeFirePressed() {
      const pressed = input.firePressed;
      input.firePressed = false;
      return pressed;
    },
  };
}
