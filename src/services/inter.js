import fetch from 'node-fetch';
import fs from 'fs';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const INTER_ENV = process.env.INTER_ENV || 'sandbox';
const BASE_URL = INTER_ENV === 'sandbox' 
  ? 'https://cdpj.partners.bancointer.com.br' 
  : 'https://cdpj.partners.bancointer.com.br';

let accessToken = null;
let tokenExpiresAt = 0;

const httpsAgent = new https.Agent({
  cert: fs.readFileSync(process.env.INTER_CERT_PATH),
  key: fs.readFileSync(process.env.INTER_KEY_PATH)
});

async function autenticar() {
  const now = Date.now();
  if (accessToken && now < tokenExpiresAt) {
    return accessToken;
  }

  const credentials = Buffer.from(
    `${process.env.INTER_CLIENT_ID}:${process.env.INTER_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${BASE_URL}/oauth/v2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: 'grant_type=client_credentials&scope=extrato.read boleto-cobranca.read boleto-cobranca.write pix.write pix.read',
    agent: httpsAgent
  });

  if (!response.ok) {
    throw new Error(`Falha na autenticação Inter: ${response.statusText}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in * 1000) - 60000;
  return accessToken;
}

async function gerarQRCode(valor, txid, descricao) {
  const token = await autenticar();
  const response = await fetch(`${BASE_URL}/pix/v2/cob/${txid}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    agent: httpsAgent,
    body: JSON.stringify({
      calendario: {
        expiracao: 3600
      },
      valor: {
        original: valor.toFixed(2)
      },
      chave: process.env.INTER_CONTA_CORRENTE,
      solicitacaoPagador: descricao
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Falha ao gerar QR Code: ${response.status} - ${error}`);
  }

  return response.json();
}

async function enviarPixOut(chavePix, valor, descricao, txid) {
  const token = await autenticar();
  const response = await fetch(`${BASE_URL}/pix/v2/pix`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    agent: httpsAgent,
    body: JSON.stringify({
      valor: valor.toFixed(2),
      chave: chavePix,
      descricao,
      identificador: txid
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Falha ao enviar Pix Out: ${response.status} - ${error}`);
  }

  return response.json();
}

async function consultarPagamento(txid) {
  const token = await autenticar();
  const response = await fetch(`${BASE_URL}/pix/v2/cob/${txid}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    agent: httpsAgent
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar pagamento: ${response.statusText}`);
  }

  return response.json();
}

export { autenticar, gerarQRCode, enviarPixOut, consultarPagamento };
