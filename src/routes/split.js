import { pool } from '../db.js';
import { enviarPixOut } from '../services/inter.js';
import { notificarApp } from '../services/notificador.js';
import { v4 as uuidv4 } from 'uuid';

async function processarSplit(cobrancaId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cobResult = await client.query(
      'SELECT * FROM cobrancas WHERE id = $1 FOR UPDATE',
      [cobrancaId]
    );

    if (cobResult.rows.length === 0) {
      throw new Error('Cobrança não encontrada');
    }

    const cobranca = cobResult.rows[0];
    const valorMotorista = (cobranca.valor * cobranca.percentual_motorista) / 100;
    const valorPlataforma = cobranca.valor - valorMotorista;

    const splitResult = await client.query(
      `INSERT INTO splits 
       (cobranca_id, corrida_id, valor_total, valor_motorista, valor_plataforma, chave_pix_motorista, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
       RETURNING *`,
      [cobranca.id, cobranca.corrida_id, cobranca.valor, valorMotorista, valorPlataforma, cobranca.chave_pix_motorista]
    );

    const split = splitResult.rows[0];
    const pixOutTxid = uuidv4().replace(/-/g, '').substring(0, 35);

    const pixOutResult = await enviarPixOut(
      cobranca.chave_pix_motorista,
      valorMotorista,
      `Split corrida ${cobranca.corrida_id}`,
      pixOutTxid
    );

    await client.query(
      `UPDATE splits 
       SET pix_out_id = $1, status = 'enviado', enviado_em = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [pixOutResult.endToEndId || pixOutTxid, split.id]
    );

    await client.query(
      `UPDATE cobrancas 
       SET status = 'split_realizado', split_em = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [cobranca.id]
    );

    await client.query('COMMIT');

    await notificarApp(cobranca.app_origem, cobranca.corrida_id, 'pago', {
      valor_total: cobranca.valor,
      valor_motorista: valorMotorista,
      valor_plataforma: valorPlataforma,
      pago_em: cobranca.pago_em
    });

    return split;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function splitRoutes(fastify, options) {
  fastify.post('/zighu/split/:cobranca_id', async (request, reply) => {
    const { cobranca_id } = request.params;
    try {
      const split = await processarSplit(parseInt(cobranca_id));
      return split;
    } catch (error) {
      return reply.status(500).send({ error: error.message });
    }
  });
}

export { splitRoutes, processarSplit };
export default splitRoutes;
