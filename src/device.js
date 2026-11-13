// Zentrale Geraete-Erkennung und GPU-sparende Helfer fuer Mobilgeraete.

export const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

// Die GLB-Modelle betten ihre Texturen als WebP mit bis zu 2048px ein.
// Auf mobilen GPUs sprengt das schnell den GPU-Speicher (WebGL-Kontext
// geht verloren -> "Grafik wurde unterbrochen"). Auf Touch-Geraeten werden
// die Texturen daher nach dem Laden per Canvas auf maxSize heruntergerechnet.
// KTX2-/CompressedTextures (kein plain image) werden uebersprungen.
export function limitTextureSize(root, maxSize = 1024) {
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const key of Object.keys(m)) {
        const t = m[key];
        if (!t || !t.isTexture || done.has(t)) continue;
        done.add(t);
        const img = t.image;
        if (!img || !img.width || !img.height) continue; // z.B. KTX2
        const s = Math.min(1, maxSize / Math.max(img.width, img.height));
        if (s >= 1) continue;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        t.image = c;
        t.needsUpdate = true;
      }
    }
  });
}
