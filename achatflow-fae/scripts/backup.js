'use strict';
/* Sauvegarde à chaud de la base SQLite + copie des pièces jointes. Usage : npm run backup [dossier] */
const fs = require('fs'); const path = require('path');
const config = require('../server/config'); const db = require('../server/db');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const out = path.resolve(process.argv[2] || path.join(config.DATA_DIR, 'backups', stamp));
fs.mkdirSync(out, { recursive: true });
db.backup(path.join(out, 'achatflow.db')).then(() => {
  const up = path.join(config.DATA_DIR, 'uploads'); const dst = path.join(out, 'uploads');
  if (fs.existsSync(up)) fs.cpSync(up, dst, { recursive: true });
  console.log('Sauvegarde créée dans ' + out);
  // conserve les 14 dernières sauvegardes automatiques
  const root = path.join(config.DATA_DIR, 'backups');
  if (fs.existsSync(root)) fs.readdirSync(root).sort().slice(0, -14).forEach((d) => fs.rmSync(path.join(root, d), { recursive: true, force: true }));
  process.exit(0);
}).catch((e) => { console.error('Échec de la sauvegarde :', e.message); process.exit(1); });
