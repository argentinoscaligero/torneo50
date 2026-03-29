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
function readJSON(file){ return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

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
      scores[id] = { h: m.scoreH, a: m.scoreA };
    }
  });
  res.json(scores);
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
