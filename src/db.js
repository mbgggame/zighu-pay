import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const { Pool } = pg

// Extrai parâmetros da URL para forçar IPv4
const dbUrl = new URL(process.env.DATABASE_URL)

const pool = new Pool({
  host:               dbUrl.hostname,
  port:               Number(dbUrl.port) || 6543,
  database:           decodeURIComponent(dbUrl.pathname.slice(1)),
  user:               decodeURIComponent(dbUrl.username),
  password:           decodeURIComponent(dbUrl.password),
  ssl:                { rejectUnauthorized: false },
  family:             4,
  connectionTimeoutMillis: 10000
})

async function initializeDatabase() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cobrancas (
        id SERIAL PRIMARY KEY,
        corrida_id INTEGER NOT NULL,
        valor DOUBLE PRECISION NOT NULL,
        motorista_id INTEGER NOT NULL,
        chave_pix_motorista TEXT NOT NULL,
        percentual_motorista INTEGER DEFAULT 82,
        status TEXT DEFAULT 'aguardando_pagamento',
        qr_code TEXT,
        pix_copia_cola TEXT,
        inter_txid TEXT UNIQUE,
        inter_payment_id TEXT,
        app_origem TEXT DEFAULT 'mobihub',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pago_em TIMESTAMP,
        split_em TIMESTAMP
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS splits (
        id SERIAL PRIMARY KEY,
        cobranca_id INTEGER REFERENCES cobrancas(id),
        corrida_id INTEGER NOT NULL,
        valor_total DOUBLE PRECISION NOT NULL,
        valor_motorista DOUBLE PRECISION NOT NULL,
        valor_plataforma DOUBLE PRECISION NOT NULL,
        chave_pix_motorista TEXT NOT NULL,
        pix_out_id TEXT,
        status TEXT DEFAULT 'pendente',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        enviado_em TIMESTAMP
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id SERIAL PRIMARY KEY,
        origem TEXT NOT NULL,
        payload JSONB NOT NULL,
        processado BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS apps_clientes (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        callback_url TEXT NOT NULL,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    const existe = await client.query(
      'SELECT id FROM apps_clientes WHERE nome = $1', ['mobihub']
    )
    if (existe.rows.length === 0 && process.env.MOBIHUB_API_KEY && process.env.MOBIHUB_CALLBACK_URL) {
      await client.query(
        'INSERT INTO apps_clientes (nome, api_key, callback_url) VALUES ($1, $2, $3)',
        ['mobihub', process.env.MOBIHUB_API_KEY, process.env.MOBIHUB_CALLBACK_URL]
      )
    }
    console.log('[DB] Banco inicializado com sucesso')
  } finally {
    client.release()
  }
}

export { pool, initializeDatabase }
