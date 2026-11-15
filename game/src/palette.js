// Senja Harbor look plan: one dusk palette for the whole game. Teal dusk sky, warm
// orange lamps, rusted containers, pale ink for the HUD. Every colour in the game
// comes from these names; the CSS in index.html uses the same six.
export const PALETTE = {
  sky: '#16303e',
  horizon: '#e8734a',
  asphalt: '#22252a',
  ink: '#f2ead9',
  muted: '#8fa3ad',
  accent: '#ff9a3d',
  lamp: '#ffb347',
  containerTeal: '#2f6f6a',
  containerOrange: '#c96a2e',
  containerRust: '#8a4a3a',
  containerSlate: '#4a5a66',
  containerSand: '#a8834f',
  elang: '#3fae8a',
  komodo: '#e0524d',
  marking: '#d8b13c',
  smoke: '#9aa5a8',
};

export function hex(name) {
  return PALETTE[name];
}
