CREATE DATABASE IF NOT EXISTS bolao_puro_pao
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bolao_puro_pao;

CREATE TABLE IF NOT EXISTS games (
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
);

CREATE TABLE IF NOT EXISTS bets (
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
);

INSERT INTO games (team_a, team_b, game_date, game_time, bet_limit, bet_value, status)
SELECT 'Brasil', 'Haiti', '2026-06-19', '21:30:00', '21:00:00', 10.00, 'Aberto'
WHERE NOT EXISTS (SELECT 1 FROM games LIMIT 1);
