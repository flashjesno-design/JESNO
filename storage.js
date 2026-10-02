'use strict';
/* Détecte si le dossier de données survit aux redémarrages (disque persistant monté). */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let cached = null;
function storageStatus() {
  if (cached) return cached;
  const dir = path.resolve(config.DATA_DIR);
  let mounts = [];
  try { mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')[1]).filter(Boolean); } catch (e) { /* hors Linux */ }
  // le point de montage le plus spécifique qui contient DATA_DIR
  const mount = mounts.filter((m) => m !== '/' && (dir === m || dir.startsWith(m.endsWith('/') ? m : m + '/'))).sort((a, b) => b.length - a.length)[0] || null;
  const onHost = !!process.env.RENDER || config.NODE_ENV === 'production';
  let persistent = null; // inconnu (poste local, Docker avec volume…)
  if (process.env.RENDER) persistent = !!mount; // Render : sans disque monté, tout est effacé au redémarrage
  else if (mount) persistent = true;
  cached = { persistent, dir, mount, host: process.env.RENDER ? 'render' : (onHost ? 'serveur' : 'local') };
  return cached;
}
module.exports = { storageStatus };
