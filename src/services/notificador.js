import fetch from 'node-fetch';
import { pool } from '../db.js';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function notificarApp(appOrigem, corridaId, status, dados) {
  const client = await pool.connect();
  try {
    const appResult = await client.query(
      'SELECT callback_url FROM apps_clientes WHERE nome = $1 AND ativo = true',
      [appOrigem]
    );

    if (appResult.rows.length === 0) {
      console.log(`App ${appOrigem} não encontrado ou inativo`);
      return;
    }

    const { callback_url } = appResult.rows[0];
    const payload = {
      corrida_id: corridaId,
      status,
      valor_total: dados.valor_total,
      valor_motorista: dados.valor_motorista,
      valor_plataforma: dados.valor_plataforma,
      pago_em: dados.pago_em
    };

    const delays = [5000, 15000, 30000];
    let success = false;

    for (let i = 0; i < delays.length && !success; i++) {
      try {
        const response = await fetch(callback_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          success = true;
          console.log(`Notificação enviada com sucesso para ${appOrigem}`);
        } else {
          console.error(`Falha na notificação (tentativa ${i + 1}): ${response.statusText}`);
          if (i < delays.length - 1) {
            await delay(delays[i]);
          }
        }
      } catch (error) {
        console.error(`Erro na notificação (tentativa ${i + 1}):`, error);
        if (i < delays.length - 1) {
          await delay(delays[i]);
        }
      }
    }

    await client.query(
      'INSERT INTO webhook_logs (origem, payload, processado) VALUES ($1, $2, $3)',
      [appOrigem, payload, success]
    );

  } finally {
    client.release();
  }
}

export { notificarApp };
