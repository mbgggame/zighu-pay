import { pool } from '../db.js';
import { gerarQRCode, MOCK_MODE, autenticar } from '../services/inter.js';
import { processarSplit } from './split.js';
import { v4 as uuidv4 } from 'uuid';

async function cobrancasRoutes(fastify, options) {
  fastify.post('/zighu/cobranca', async (request, reply) => {
    const { corrida_id, valor, motorista_id, chave_pix, percentual_motorista = 82, app_origem = 'mobihub' } = request.body;
    const txid = uuidv4().replace(/-/g, '').substring(0, 35);

    const client = await pool.connect();
    try {
      const qrData = await gerarQRCode(valor, txid, `Cobrança corrida ${corrida_id}`);
      
      const result = await client.query(
        `INSERT INTO cobrancas 
         (corrida_id, valor, motorista_id, chave_pix_motorista, percentual_motorista, app_origem, inter_txid, qr_code, pix_copia_cola, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'aguardando_pagamento')
         RETURNING id, qr_code, pix_copia_cola, inter_txid, status`,
        [corrida_id, valor, motorista_id, chave_pix, percentual_motorista, app_origem, txid, qrData.qrcode, qrData.pixCopiaECola]
      );

      const cobranca = result.rows[0];
      return {
        cobranca_id: cobranca.id,
        qr_code: cobranca.qr_code,
        pix_copia_cola: cobranca.pix_copia_cola,
        txid: cobranca.inter_txid,
        status: cobranca.status
      };
    } finally {
      client.release();
    }
  });

  fastify.get('/zighu/cobranca/:corrida_id', async (request, reply) => {
    const { corrida_id } = request.params;
    const client = await pool.connect();
    try {
      const cobResult = await client.query(
        'SELECT * FROM cobrancas WHERE corrida_id = $1',
        [corrida_id]
      );

      if (cobResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Cobrança não encontrada' });
      }

      const cobranca = cobResult.rows[0];
      const valorMotorista = (cobranca.valor * cobranca.percentual_motorista) / 100;
      const valorPlataforma = cobranca.valor - valorMotorista;

      return {
        status: cobranca.status,
        pago_em: cobranca.pago_em,
        valor_motorista: valorMotorista,
        valor_plataforma: valorPlataforma
      };
    } finally {
      client.release();
    }
  });

  fastify.get('/zighu/conciliacao', async (request, reply) => {
    const { data, app = 'mobihub' } = request.query;
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT c.*, s.valor_motorista, s.valor_plataforma, s.status as split_status
         FROM cobrancas c
         LEFT JOIN splits s ON c.id = s.cobranca_id
         WHERE DATE(c.created_at) = $1 AND c.app_origem = $2`,
        [data, app]
      );
      return result.rows;
    } finally {
      client.release();
    }
  });

  fastify.get('/zighu/health', async (request, reply) => {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { status: 'ok', versao: '1.0.0', banco: 'conectado' };
    } catch (error) {
      return { status: 'error', versao: '1.0.0', banco: 'desconectado', error: error.message };
    } finally {
      client.release();
    }
  });

  fastify.post('/zighu/mock/simular-pagamento', async (request, reply) => {
    if (!MOCK_MODE) {
      return reply.status(403).send({ error: 'Rota só disponível em modo mock' });
    }

    const { corrida_id } = request.body;
    const client = await pool.connect();
    try {
      const cobResult = await client.query(
        'SELECT * FROM cobrancas WHERE corrida_id = $1',
        [corrida_id]
      );

      if (cobResult.rows.length === 0) {
        return reply.status(404).send({ error: 'Cobrança não encontrada' });
      }

      const cobranca = cobResult.rows[0];
      await client.query(
        `UPDATE cobrancas 
         SET status = 'pago', pago_em = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [cobranca.id]
      );

      await processarSplit(cobranca.id);

      return { success: true, message: 'Pagamento simulado com sucesso' };
    } finally {
      client.release();
    }
  });

  // GET /zighu/admin/dashboard — retorna métricas do dia
  fastify.get('/zighu/admin/dashboard', async (request, reply) => {
    const client = await pool.connect();
    try {
      const hoje = new Date().toISOString().split('T')[0];
      
      const cobResult = await client.query(
        'SELECT COUNT(*) as total FROM cobrancas WHERE DATE(created_at) = $1',
        [hoje]
      );
      const totalCobrancas = parseInt(cobResult.rows[0].total);

      const valResult = await client.query(
        'SELECT COALESCE(SUM(valor), 0) as total FROM cobrancas WHERE DATE(created_at) = $1 AND status = $2',
        [hoje, 'pago']
      );
      const valorProcessado = parseFloat(valResult.rows[0].total);

      const splitResult = await client.query(
        'SELECT COUNT(*) as total FROM splits WHERE DATE(created_at) = $1 AND status = $2',
        [hoje, 'enviado']
      );
      const totalSplits = parseInt(splitResult.rows[0].total);

      const statusInter = MOCK_MODE ? 'Mock' : 'Online';

      return {
        total_cobrancas: totalCobrancas,
        valor_processado: valorProcessado,
        total_splits: totalSplits,
        status_inter: statusInter
      };
    } finally {
      client.release();
    }
  });

  // GET /zighu/admin/apps — lista apps_clientes
  fastify.get('/zighu/admin/apps', async (request, reply) => {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM apps_clientes ORDER BY created_at DESC');
      return result.rows;
    } finally {
      client.release();
    }
  });

  // POST /zighu/admin/apps — cria novo app com api_key gerada automaticamente
  fastify.post('/zighu/admin/apps', async (request, reply) => {
    const { nome, callback_url } = request.body;
    const apiKey = uuidv4().replace(/-/g, '');
    const client = await pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO apps_clientes (nome, api_key, callback_url) VALUES ($1, $2, $3) RETURNING *',
        [nome, apiKey, callback_url]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  });

  // PUT /zighu/admin/apps/:id — ativa/desativa app
  fastify.put('/zighu/admin/apps/:id', async (request, reply) => {
    const { id } = request.params;
    const { ativo } = request.body;
    const client = await pool.connect();
    try {
      const result = await client.query(
        'UPDATE apps_clientes SET ativo = $1 WHERE id = $2 RETURNING *',
        [ativo, id]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  });

  // GET /zighu/admin/logs — retorna últimos 50 webhook_logs
  fastify.get('/zighu/admin/logs', async (request, reply) => {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 50');
      return result.rows;
    } finally {
      client.release();
    }
  });

  // GET /zighu/admin/cobran — lista cobranças com filtro de data
  fastify.get('/zighu/admin/cobran', async (request, reply) => {
    const { data } = request.query;
    const dataFiltro = data || new Date().toISOString().split('T')[0];
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT c.*, s.valor_motorista, s.valor_plataforma, s.status as split_status
         FROM cobrancas c
         LEFT JOIN splits s ON c.id = s.cobranca_id
         WHERE DATE(c.created_at) = $1
         ORDER BY c.created_at DESC`,
        [dataFiltro]
      );
      return result.rows;
    } finally {
      client.release();
    }
  });

  // PUT /zighu/admin/config — salva configuração do Inter (placeholder)
  fastify.put('/zighu/admin/config', async (request, reply) => {
    return { success: true, message: 'Configuração recebida (implementar persistência)' };
  });

  // GET /zighu/admin/inter/testar — testa conexão com Inter
  fastify.get('/zighu/admin/inter/testar', async (request, reply) => {
    if (MOCK_MODE) {
      return { sucesso: true, modo: 'mock' };
    }
    try {
      await autenticar();
      return { sucesso: true, modo: 'producao' };
    } catch (e) {
      return {
        sucesso: false,
        erro: e.message,
        stack: e.stack?.split('\n').slice(0, 3).join(' | '),
        code: e.code
      };
    }
  });
}

export default cobrancasRoutes;
