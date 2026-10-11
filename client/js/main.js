// Entry point: checks WebGL2 support, boots the game.
import { Game } from './game/game.js';

const status = document.getElementById('boot-status');
const bootScreen = document.getElementById('boot-screen');

function fail(msg) {
  status.textContent = msg;
  status.style.color = '#ffb000';
  status.style.letterSpacing = '0.05em';
  status.style.textTransform = 'none';
  status.style.maxWidth = '640px';
  status.style.textAlign = 'center';
}

async function start() {
  const test = document.createElement('canvas').getContext('webgl2');
  if (!test) {
    fail('Your browser or graphics driver does not support WebGL 2. Use an up-to-date Firefox or Chromium and enable hardware acceleration (in a VM, enable 3D acceleration).');
    return;
  }
  try {
    status.textContent = 'Building the world…';
    const game = new Game(document.getElementById('game-canvas'), document.getElementById('ui-root'));
    await game.boot();
    bootScreen.classList.add('hidden');
    setTimeout(() => bootScreen.remove(), 800);
  } catch (e) {
    console.error(e);
    fail('Failed to start: ' + (e && e.message ? e.message : e));
  }
}

start();
