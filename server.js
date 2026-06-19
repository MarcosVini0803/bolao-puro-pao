require('dotenv').config();

const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const isTiDB = (process.env.DB_HOST || '').includes('tidbcloud.com');
const sslConfig = isTiDB ? { minVersion: 'TLSv1.2', rejectUnauthorized: false } : undefined;

async function createServerDatabaseIfNeeded() {
  const base = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true,
    ssl: sslConfig
  });

  await base.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'bolao_puro_pao'}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await base.end();
}

let pool;

async function connectPool() {
  await createServerDatabaseIfNeeded();

  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bolao_puro_pao',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: sslConfig
  });
}

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_a VARCHAR(100) NOT NULL,
    team_b VARCHAR(100) NOT NULL,
    game_date DATE NOT NULL,
    game_time TIME NOT NULL,
    bet_limit TIME NOT NULL,
    bet_value DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    status ENUM('Aberto','Encerrado','Finalizado') NOT NULL DEFAULT 'Aberto',
    final_a INT NULL,
    final_b INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    score_a INT NOT NULL,
    score_b INT NOT NULL,
    proof_file VARCHAR(255) NULL,
    proof_note TEXT NULL,
    status ENUM('Pendente','Pago','Cancelado') NOT NULL DEFAULT 'Pendente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bets_game FOREIGN KEY (game_id) REFERENCES games(id)
  )`);

  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM games');
  if (rows[0].total === 0) {
    await pool.query(
      `INSERT INTO games (team_a, team_b, game_date, game_time, bet_limit, bet_value, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Brasil', 'Haiti', '2026-06-19', '21:30:00', '21:00:00', 10.00, 'Aberto']
    );
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-essa-chave',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Tipo de arquivo não permitido.'), allowed.includes(file.mimetype));
  }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

function normalizeTime(t) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

app.get('/api/games', async (req, res) => {
  const [rows] = await pool.query(`SELECT id, team_a, team_b,
    DATE_FORMAT(game_date, '%Y-%m-%d') AS game_date,
    TIME_FORMAT(game_time, '%H:%i') AS game_time,
    TIME_FORMAT(bet_limit, '%H:%i') AS bet_limit,
    bet_value, status, final_a, final_b
    FROM games ORDER BY game_date DESC, game_time DESC, id DESC`);
  res.json(rows);
});

app.post('/api/bets', upload.single('proof'), async (req, res) => {
  try {
    const { game_id, name, phone, score_a, score_b, proof_note } = req.body;
    if (!game_id || !name || !phone || score_a === undefined || score_b === undefined) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    }

    const [games] = await pool.query('SELECT * FROM games WHERE id = ?', [game_id]);
    if (!games.length) return res.status(404).json({ error: 'Jogo não encontrado.' });
    if (games[0].status !== 'Aberto') return res.status(400).json({ error: 'Palpites encerrados para este jogo.' });

    const [info] = await pool.query(
      `INSERT INTO bets (game_id, name, phone, score_a, score_b, proof_file, proof_note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente')`,
      [
        Number(game_id),
        String(name).trim(),
        String(phone).trim(),
        Number(score_a),
        Number(score_b),
        req.file ? req.file.filename : null,
        proof_note ? String(proof_note).trim() : ''
      ]
    );

    res.json({ ok: true, bet_id: info.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bets', async (req, res) => {
  const params = [];
  let where = '';

  if (req.query.game_id) {
    where = 'WHERE bets.game_id = ?';
    params.push(req.query.game_id);
  }

  const [rows] = await pool.query(`SELECT bets.*, games.team_a, games.team_b, games.bet_value
    FROM bets JOIN games ON games.id = bets.game_id ${where} ORDER BY bets.id DESC`, params);

  res.json(rows.map(r => ({ ...r, proof_url: r.proof_file ? '/uploads/' + r.proof_file : null })));
});

app.get('/api/summary/:gameId', async (req, res) => {
  const [[game]] = await pool.query('SELECT * FROM games WHERE id = ?', [req.params.gameId]);
  if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });

  const [[paid]] = await pool.query('SELECT COUNT(*) AS total FROM bets WHERE game_id = ? AND status = "Pago"', [game.id]);
  const [[pending]] = await pool.query('SELECT COUNT(*) AS total FROM bets WHERE game_id = ? AND status = "Pendente"', [game.id]);

  const totalPaid = Number(paid.total) * Number(game.bet_value);
  res.json({ paid: paid.total, pending: pending.total, total_paid: totalPaid, prize: totalPaid * 0.8, organization: totalPaid * 0.2 });
});

app.post('/api/admin/login', (req, res) => {
  if (process.env.ADMIN_PASSWORD && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Senha incorreta' });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/admin/games', requireAdmin, async (req, res) => {
  const { team_a, team_b, game_date, game_time, bet_limit, bet_value } = req.body;
  if (!team_a || !team_b || !game_date || !game_time || !bet_limit || !bet_value) {
    return res.status(400).json({ error: 'Preencha todos os campos.' });
  }

  const [info] = await pool.query(
    `INSERT INTO games (team_a, team_b, game_date, game_time, bet_limit, bet_value, status)
     VALUES (?, ?, ?, ?, ?, ?, 'Aberto')`,
    [team_a, team_b, game_date, normalizeTime(game_time), normalizeTime(bet_limit), Number(bet_value)]
  );

  res.json({ ok: true, id: info.insertId });
});

app.patch('/api/admin/games/:id', requireAdmin, async (req, res) => {
  const { status, final_a, final_b } = req.body;
  await pool.query(
    `UPDATE games SET status = COALESCE(?, status), final_a = ?, final_b = ? WHERE id = ?`,
    [
      status || null,
      final_a === '' || final_a === undefined ? null : Number(final_a),
      final_b === '' || final_b === undefined ? null : Number(final_b),
      req.params.id
    ]
  );
  res.json({ ok: true });
});

app.patch('/api/admin/bets/:id', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!['Pendente', 'Pago', 'Cancelado'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

  await pool.query('UPDATE bets SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', requireAdmin, async (req, res) => {
  const [rows] = await pool.query(`SELECT bets.*, games.team_a, games.team_b,
    DATE_FORMAT(games.game_date, '%Y-%m-%d') AS game_date,
    TIME_FORMAT(games.game_time, '%H:%i') AS game_time,
    games.bet_value
    FROM bets JOIN games ON games.id = bets.game_id ORDER BY bets.id DESC`);

  let csv = 'ID,Jogo,Data,Hora,Nome,Telefone,Palpite,Valor,Status,Comprovante,Criado em\n';
  for (const r of rows) {
    csv += [
      r.id,
      `${r.team_a} x ${r.team_b}`,
      r.game_date,
      r.game_time,
      r.name,
      r.phone,
      `${r.team_a} ${r.score_a} x ${r.score_b} ${r.team_b}`,
      r.bet_value,
      r.status,
      r.proof_file ? 'Enviado' : 'Não enviado',
      r.created_at
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="palpites_bolao.csv"');
  res.send('\ufeff' + csv);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

connectPool()
  .then(initDb)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Bolão MySQL rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao conectar/criar banco MySQL.');
    console.error('Confira o arquivo .env: DB_USER, DB_PASSWORD e se o MySQL/TiDB está rodando.');
    console.error(err.message);
    process.exit(1);
  });
