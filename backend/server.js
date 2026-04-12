/**
 * Backend - Campeonato Máster +50 Femenino 2026
 * Iniciar: node backend/server.js  (desde la carpeta raíz del proyecto)
 * Puerto:  3000 (configurable via PORT env var)
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'master50-secret-2026-changeme';

// ── paths ──────────────────────────────────────────────
const ROOT_DIR    = path.join(__dirname, '..');
const USERS_FILE  = path.join(__dirname, 'data', 'users.json');
const MATCHES_FILE= path.join(__dirname, 'data', 'matches.json');

// ── middleware ─────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(ROOT_DIR)); // sirve index.html, assets, etc.

// ── helpers ────────────────────────────────────────────
function readJSON(file){
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch(e) {
    console.error(`[ERROR] readJSON failed for ${file}:`, e.message);
    throw e; // re-throw para que el route devuelva 500 en vez de crashear el proceso
  }
}
function writeJSON(file, data){
  // Escribir en archivo temporal primero, luego renombrar (atomic write)
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch(e) {
    console.error(`[ERROR] writeJSON failed for ${file}:`, e.message);
    try { fs.unlinkSync(tmp); } catch(_){}
    throw e;
  }
}

function authMiddleware(req, res, next){
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '');
  if(!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e){
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function isAdmin(req){ return req.user && req.user.group === 'ADMIN'; }

// ═══════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════

// POST /api/login
app.post('/api/login', (req, res) => {
  const { team, password } = req.body;
  if(!team || !password) return res.status(400).json({ error: 'Faltan campos' });

  const users = readJSON(USERS_FILE);
  const user  = users[team];
  if(!user) return res.status(401).json({ error: 'Equipo no encontrado' });

  // Soporte para passwords en texto plano (durante setup) y bcrypt hash
  let valid = false;
  if(user.password.startsWith('$2')) {
    valid = bcrypt.compareSync(password, user.password);
  } else {
    valid = (password === user.password);
  }

  if(!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

  const token = jwt.sign(
    { team, group: user.group },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, team, group: user.group });
});

// ═══════════════════════════════════════════════════════
//  MATCHES (público - lectura)
// ═══════════════════════════════════════════════════════

// GET /api/matches  → scores para el fixture público
app.get('/api/matches', (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const scores  = {};
  Object.keys(matches).forEach(id => {
    const m = matches[id];
    if(m.scoreH !== null && m.scoreA !== null){
      scores[id] = { h: m.scoreH, a: m.scoreA,
        sh: m.shootoutH ?? null, sa: m.shootoutA ?? null,
        wo: m.wo || false };
    }
  });
  res.json(scores);
});

// GET /api/stats  → goleadoras y tarjetas (público)
app.get('/api/stats', (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const scorers = {}, cards = {};
  Object.values(matches).forEach(m => {
    if(m.wo) return; // W.O.: los goles 5-0 no cuentan para ninguna jugadora
    (m.events||[]).forEach(ev => {
      if(!ev.player) return;
      const key = `${ev.player}||${ev.team}`;
      if(['gol','pc','ps'].includes(ev.type)){
        if(!scorers[key]) scorers[key]={player:ev.player,team:ev.team,goles:0,pc:0,ps:0,total:0};
        scorers[key][ev.type]++;
        scorers[key].total++;
      }
      if(['amarilla','roja','verde'].includes(ev.type)){
        if(!cards[key]) cards[key]={player:ev.player,team:ev.team,amarilla:0,roja:0,verde:0};
        cards[key][ev.type]++;
      }
    });
  });
  res.json({
    scorers: Object.values(scorers).sort((a,b)=>b.total-a.total),
    cards: Object.values(cards).sort((a,b)=>(b.amarilla+b.roja+b.verde)-(a.amarilla+a.roja+a.verde))
  });
});

// GET /api/matches/:id/public  → datos públicos del partido (sin auth)
app.get('/api/matches/:id/public', (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });
  const { home, away, group, sede, horario, r1, r2,
          scoreH, scoreA, shootoutH, shootoutA,
          phase, mode, events,
          lineup_home, lineup_away, subs_home, subs_away } = match;
  res.json({ home, away, group, sede, horario, r1, r2,
             scoreH, scoreA, shootoutH, shootoutA,
             phase, mode, events: events||[],
             lineup_home: lineup_home||[], lineup_away: lineup_away||[],
             subs_home: subs_home||[], subs_away: subs_away||[] });
});

// GET /api/matches/full  → todos los datos (requiere auth)
app.get('/api/matches/full', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  if(isAdmin(req)) return res.json(matches);

  // Equipo solo ve sus propios partidos con lineup
  const teamMatches = {};
  Object.keys(matches).forEach(id => {
    const m = matches[id];
    if(m.home === req.user.team || m.away === req.user.team){
      teamMatches[id] = m;
    }
  });
  res.json(teamMatches);
});

// GET /api/matches/:id  → un partido
app.get('/api/matches/:id', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const { team } = req.user;
  if(!isAdmin(req) && match.home !== team && match.away !== team){
    return res.status(403).json({ error: 'No autorizado para este partido' });
  }
  res.json(match);
});

// ═══════════════════════════════════════════════════════
//  SUBMIT PLANILLA
// ═══════════════════════════════════════════════════════

// POST /api/matches/:id/result
// Body: { scoreH, scoreA, lineup_home, lineup_away, events }
//   lineup: [ { nro, apellido, nombre, titular: true/false } ]
//   events: [ { type: 'gol'|'amarilla'|'roja'|'verde'|'pc'|'ps', minuto, team, player } ]
app.post('/api/matches/:id/result', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const id      = req.params.id;
  const match   = matches[id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const { team } = req.user;
  if(!isAdmin(req) && match.home !== team && match.away !== team){
    return res.status(403).json({ error: 'No autorizado para este partido' });
  }

  const { scoreH, scoreA, lineup_home, lineup_away, events, shootoutH, shootoutA } = req.body;

  // Validaciones básicas
  if(scoreH === undefined || scoreA === undefined){
    return res.status(400).json({ error: 'Faltan scoreH o scoreA' });
  }
  if(typeof scoreH !== 'number' || typeof scoreA !== 'number' || scoreH < 0 || scoreA < 0){
    return res.status(400).json({ error: 'Scores inválidos' });
  }

  match.scoreH       = scoreH;
  match.scoreA       = scoreA;
  match.shootoutH    = shootoutH ?? null;
  match.shootoutA    = shootoutA ?? null;
  match.lineup_home  = lineup_home  || match.lineup_home;
  match.lineup_away  = lineup_away  || match.lineup_away;
  match.events       = events       || match.events;
  match.submitted    = true;
  match.submitted_by = team;
  match.submitted_at = new Date().toISOString();

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok: true, match });
});

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════

function calcScore(match){
  const GOAL_TYPES = ['gol','pc','ps'];
  let h = 0, a = 0;
  (match.events||[]).forEach(ev => {
    if(!GOAL_TYPES.includes(ev.type)) return;
    if(ev.team === match.home) h++;
    else if(ev.team === match.away) a++;
  });
  match.scoreH = h;
  match.scoreA = a;
}

function authCheck(req, res, match){
  if(isAdmin(req)) return true;
  if(match.home === req.user.team || match.away === req.user.team) return true;
  res.status(403).json({ error: 'No autorizado para este partido' });
  return false;
}

// ═══════════════════════════════════════════════════════
//  FORMACIÓN (pre-partido, sin necesitar resultado)
// ═══════════════════════════════════════════════════════

// POST /api/matches/:id/lineup
// Body: { side:'home'|'away', titulares:[], suplentes:[] }
app.post('/api/matches/:id/lineup', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });
  if(!authCheck(req, res, match)) return;

  const { titulares=[], suplentes=[] } = req.body;
  // Auto-detectar lado según equipo logueado
  const side = req.body.side || (match.home === req.user.team ? 'home' : 'away');

  if(side === 'home'){
    match.lineup_home    = titulares;
    match.subs_home      = suplentes;
    match.lineup_home_ok = true;
  } else {
    match.lineup_away    = titulares;
    match.subs_away      = suplentes;
    match.lineup_away_ok = true;
  }

  // Avanzar fase si estaba en 'pre'
  if(!match.phase || match.phase === 'pre') match.phase = 'lineup_sent';

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok: true, match });
});

// ═══════════════════════════════════════════════════════
//  EVENTOS (uno a uno, calcula score automático)
// ═══════════════════════════════════════════════════════

// POST /api/matches/:id/event
// Body: { type, team, player, minuto, quarter }
app.post('/api/matches/:id/event', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });
  if(!authCheck(req, res, match)) return;

  const { type, team, player='', minuto=0, quarter=1 } = req.body;
  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    type, team, player, minuto: Number(minuto), quarter: Number(quarter),
    addedAt: new Date().toISOString()
  };

  if(!match.events) match.events = [];
  match.events.push(event);
  match.events.sort((a,b) => (a.quarter-b.quarter)||( a.minuto-b.minuto));

  calcScore(match);

  // Asegurarse que la fase sea 'partido'
  if(!match.phase || match.phase === 'pre' || match.phase === 'lineup_sent'){
    match.phase = 'partido';
  }

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok:true, event, scoreH: match.scoreH, scoreA: match.scoreA });
});

// DELETE /api/matches/:id/event/:eid
app.delete('/api/matches/:id/event/:eid', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });
  if(!authCheck(req, res, match)) return;

  match.events = (match.events||[]).filter(e => e.id !== req.params.eid);
  calcScore(match);

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok:true, scoreH: match.scoreH, scoreA: match.scoreA });
});

// ═══════════════════════════════════════════════════════
//  FASE (transiciones de estado del partido)
// ═══════════════════════════════════════════════════════

// POST /api/matches/:id/phase
// Body: { phase:'partido'|'done', mode:'live'|'post', scoreH, scoreA }
app.post('/api/matches/:id/phase', authMiddleware, (req, res) => {
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });
  if(!authCheck(req, res, match)) return;

  const { phase, mode, scoreH, scoreA, shootoutH, shootoutA } = req.body;

  if(phase === 'done'){
    if(!match.lineup_home_ok || !match.lineup_away_ok){
      return res.status(400).json({
        error: `Falta confirmar la formación de: ${!match.lineup_home_ok ? match.home : match.away}.`
      });
    }
    match.submitted    = true;
    match.submitted_at = new Date().toISOString();
    match.submitted_by = req.user.team;
  }

  match.phase = phase;
  if(mode !== undefined)      match.mode      = mode;
  if(scoreH !== undefined)    match.scoreH    = scoreH;
  if(scoreA !== undefined)    match.scoreA    = scoreA;
  if(shootoutH !== undefined) match.shootoutH = shootoutH;
  if(shootoutA !== undefined) match.shootoutA = shootoutA;

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok:true, match });
});

// ═══════════════════════════════════════════════════════
//  ADMIN - editar resultado / W.O.
// ═══════════════════════════════════════════════════════

// POST /api/matches/:id/admin-edit  → editar resultado (admin)
app.post('/api/matches/:id/admin-edit', authMiddleware, (req, res) => {
  if(!isAdmin(req)) return res.status(403).json({ error: 'Solo el admin puede editar resultados' });
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const { scoreH, scoreA, shootoutH, shootoutA, phase } = req.body;
  if(scoreH !== undefined) match.scoreH = scoreH === '' ? null : Number(scoreH);
  if(scoreA !== undefined) match.scoreA = scoreA === '' ? null : Number(scoreA);
  match.shootoutH = (shootoutH !== undefined && shootoutH !== '' && shootoutH !== null)
    ? Number(shootoutH) : null;
  match.shootoutA = (shootoutA !== undefined && shootoutA !== '' && shootoutA !== null)
    ? Number(shootoutA) : null;
  if(phase) match.phase = phase;
  // Si se reabre el partido, limpiar el flag W.O.
  if(phase && phase !== 'done') { match.wo = false; match.wo_winner = null; }

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok: true, match });
});

// POST /api/matches/:id/wo  → W.O. (admin)
app.post('/api/matches/:id/wo', authMiddleware, (req, res) => {
  if(!isAdmin(req)) return res.status(403).json({ error: 'Solo el admin puede declarar W.O.' });
  const matches = readJSON(MATCHES_FILE);
  const match   = matches[req.params.id];
  if(!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const { winner } = req.body; // 'home' | 'away'
  if(!['home','away'].includes(winner))
    return res.status(400).json({ error: 'winner debe ser "home" o "away"' });

  match.wo          = true;
  match.wo_winner   = winner;
  match.scoreH      = winner === 'home' ? 5 : 0;
  match.scoreA      = winner === 'away' ? 5 : 0;
  match.shootoutH   = null;
  match.shootoutA   = null;
  match.events      = []; // sin eventos → sin stats de jugadoras
  match.phase       = 'done';
  match.submitted_at = new Date().toISOString();

  writeJSON(MATCHES_FILE, matches);
  res.json({ ok: true, match });
});

// ═══════════════════════════════════════════════════════
//  ADMIN - cambiar contraseña
// ═══════════════════════════════════════════════════════

// POST /api/admin/change-password
app.post('/api/admin/change-password', authMiddleware, (req, res) => {
  const { team, newPassword } = req.body;
  if(!isAdmin(req) && req.user.team !== team){
    return res.status(403).json({ error: 'Solo el admin puede cambiar contraseñas de otros equipos' });
  }
  if(!newPassword || newPassword.length < 4){
    return res.status(400).json({ error: 'Contraseña demasiado corta (mín 4 caracteres)' });
  }

  const users    = readJSON(USERS_FILE);
  const targetTeam = team || req.user.team;
  if(!users[targetTeam]) return res.status(404).json({ error: 'Equipo no encontrado' });

  users[targetTeam].password = bcrypt.hashSync(newPassword, 10);
  writeJSON(USERS_FILE, users);
  res.json({ ok: true, message: `Contraseña de "${targetTeam}" actualizada` });
});

// ═══════════════════════════════════════════════════════
//  ADMIN - listar usuarios
// ═══════════════════════════════════════════════════════

app.get('/api/admin/users', authMiddleware, (req, res) => {
  if(!isAdmin(req)) return res.status(403).json({ error: 'Solo admin' });
  const users = readJSON(USERS_FILE);
  const list  = Object.keys(users).map(t => ({ team: t, group: users[t].group }));
  res.json(list);
});

// ═══════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════

// Migrar datos existentes: agregar phase, subs, ids en eventos
(function migrateData(){
  let matches;
  try {
    matches = readJSON(MATCHES_FILE);
  } catch(e) {
    console.error('[migrateData] matches.json inválido — el servidor arranca igual, pero hay que corregir el archivo.');
    return; // no crashear el proceso
  }
  let changed = false;
  Object.values(matches).forEach(m => {
    if(!m.phase){ m.phase = m.submitted ? 'done' : 'pre'; changed = true; }
    if(!m.subs_home){ m.subs_home = []; changed = true; }
    if(!m.subs_away){ m.subs_away = []; changed = true; }
    if(m.lineup_home_ok === undefined){ m.lineup_home_ok = !!(m.lineup_home && m.lineup_home.length); changed = true; }
    if(m.lineup_away_ok === undefined){ m.lineup_away_ok = !!(m.lineup_away && m.lineup_away.length); changed = true; }
    (m.events||[]).forEach(ev => {
      if(!ev.id){
        ev.id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        changed = true;
      }
    });
  });
  if(changed) writeJSON(MATCHES_FILE, matches);
})();

// ── Global error handler (evita crasheos por excepciones no capturadas) ──
app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled in route:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message, err.stack);
  // No salir — pm2 igual lo va a reiniciar, pero loguear el error
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

app.listen(PORT, () => {
  console.log(`\n✅  Servidor Torneo Máster +50 corriendo en http://localhost:${PORT}`);
  console.log(`📋  Accedé a la app en: http://localhost:${PORT}/index.html`);
  console.log(`📋  Planilla equipos:   http://localhost:${PORT}/planilla.html`);
  console.log(`\n🔑  Credenciales por defecto (cambialas luego):`);

  const users = readJSON(USERS_FILE);
  Object.keys(users).forEach(t => {
    if(!users[t].password.startsWith('$2')){
      console.log(`     ${t.padEnd(22)} → ${users[t].password}`);
    }
  });
  console.log('');
});
