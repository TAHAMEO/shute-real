// Top-down tactical map image (hillshade + land cover + roads + structures + trees) for the
// HUD minimap and the full-screen map.
import { GROUND } from '/shared/world.js';

export function buildMapImage(world, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const t = world.terrain;
  const env = world.env;
  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const grass = hex(env.ground.grass), dirt = hex(env.ground.dirt), rock = hex(env.ground.rock), forest = hex(env.ground.forest);
  const scale = world.size / size;
  // Light from the north-west for the hillshade.
  const lx = -0.6, ly = 0.65, lz = -0.45;
  const nrm = { x: 0, y: 1, z: 0 };
  for (let py = 0; py < size; py++) {
    const z = -world.half + (py + 0.5) * scale;
    for (let px = 0; px < size; px++) {
      const x = -world.half + (px + 0.5) * scale;
      t.normalAt(x, z, nrm);
      const shade = Math.max(0.25, Math.min(1.25, (nrm.x * lx + nrm.y * ly + nrm.z * lz) * 1.35 + 0.15));
      const gt = world.groundTypeAt(x, z);
      let col = grass;
      if (nrm.y < 0.74) col = rock;
      if (gt === GROUND.DIRT_ROAD || gt === GROUND.CLEARED) col = dirt;
      const h = t.heightAt(x, z);
      const hf = (h - t.minHeight) / Math.max(1, t.maxHeight - t.minHeight);
      const i = (py * size + px) * 4;
      img.data[i] = Math.min(255, col[0] * shade * (0.85 + hf * 0.4));
      img.data[i + 1] = Math.min(255, col[1] * shade * (0.85 + hf * 0.4));
      img.data[i + 2] = Math.min(255, col[2] * shade * (0.85 + hf * 0.4));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const toPx = (v) => (v + world.half) / scale;
  // Trees.
  g.fillStyle = `rgba(${forest[0] * 0.55},${forest[1] * 0.75},${forest[2] * 0.5},0.75)`;
  for (const tr of world.trees) {
    const r = Math.max(1, (2.6 * tr.scale) / scale);
    g.beginPath();
    g.arc(toPx(tr.x), toPx(tr.z), r, 0, Math.PI * 2);
    g.fill();
  }
  // Contour hint: subtle darker line every 20 m.
  // Structures.
  for (const st of world.structures) {
    if (st.type === 'fence' || st.type === 'chain_fence' || st.type === 'power_pole') continue;
    g.save();
    g.translate(toPx(st.x), toPx(st.z));
    g.rotate(-st.rot);
    g.fillStyle = 'rgba(55,52,48,0.95)';
    g.strokeStyle = 'rgba(15,15,15,0.9)';
    g.lineWidth = 1;
    const w = (st.hw * 1.6) / scale, d = (st.hd * 1.4) / scale;
    g.fillRect(-w / 2, -d / 2, w, d);
    g.strokeRect(-w / 2, -d / 2, w, d);
    g.restore();
  }
  // Play-area boundary.
  g.strokeStyle = 'rgba(255,80,60,0.85)';
  g.setLineDash([10, 8]);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(toPx(0), toPx(0), world.playRadius / scale, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // POI labels.
  g.font = `600 ${Math.round(size / 55)}px Rajdhani, 'Barlow Condensed', sans-serif`;
  g.textAlign = 'center';
  for (const p of world.pois) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(p.name.toUpperCase(), toPx(p.x) + 1, toPx(p.z) - p.r / scale - 3);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText(p.name.toUpperCase(), toPx(p.x), toPx(p.z) - p.r / scale - 4);
  }
  return c;
}
