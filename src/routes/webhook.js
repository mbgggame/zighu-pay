import { pool } from '../db.js';
import { processarSplit } from './split.js';
import crypto from 'crypto';

async function webhookRoutes(fastify, options) {
  fastify.post('/zighu/webhook/inter', async (request, reply) => {
    const client = await pool.connect();
    try {
      await client.query(
        'INSERT INTO webhook_logs (origem, payload, processado) VALUES ($1, $2, $3)',
        ['inter', request.body, false]
      );

      const webhookSecret = process.env.INTER_WEBHOOK_SECRET;
      const signature = request.headers['x-inter-signature'];
      
      if (webhookSecret && signature) {
        const hmac = crypto.createHmac('sha256', webhookSecret);
        const calculatedSignature = hmac.update(JSON.stringify(request.body)).digest('hex');
        if (calculatedSignature !== signature) {
          return reply.status(403).send({ error: 'Assinatura inválida' });
        }
      }

      const payload = request.body;
      if (payload.pix && payload.pix.length > 0) {
        const pix = payload.pix[0];
        const txid = pix.txid;

        const cobResult = await client.query(
          'SELECT * FROM cobrancas WHERE inter_txid = $1',
          [txid]
        );

        if (cobResult.rows.length > 0) {
          const cobranca = cobResult.rows[0];
          await client.query(
            `UPDATE cobrancas 
             SET status = 'pago', pago_em = CURRENT_TIMESTAMP, inter_payment_id = $1
             WHERE id = $2`,
            [pix.endToEndId, cobranca.id]
          );

          await processarSplit(cobranca.id);

          await client.query(
            'UPDATE webhook_logs SET processado = true WHERE origem = $1',
            ['inter']
          );
        }
      }

      return { received: true };
    } finally {
      client.release();
    }
  });
}

export default webhookRoutes;
