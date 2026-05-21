import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import QRCode from 'qrcode'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CERT_PATH = join(__dirname, '../../certs/inter.crt')
const KEY_PATH  = join(__dirname, '../../certs/inter.key')
export const MOCK_MODE = process.env.INTER_ENV !== 'producao'

let tokenCache = null
let tokenExpira = null
// Força renovação do token ao iniciar

export async function autenticar() {
  if (MOCK_MODE) {
    console.log('[INTER MOCK] autenticar()')
    return 'mock-token'
  }
  if (tokenCache && tokenExpira && Date.now() < tokenExpira) return tokenCache
  const cert = readFileSync(CERT_PATH)
  const key  = readFileSync(KEY_PATH)
  const params = new URLSearchParams({
    client_id:     process.env.INTER_CLIENT_ID,
    client_secret: process.env.INTER_CLIENT_SECRET,
    grant_type:    'client_credentials',
    scope:         'pix.read pix.write cob.read cob.write'
  })
  const https = await import('https')
  const agent = new https.Agent({ cert, key, rejectUnauthorized: false })
  const { default: fetch } = await import('node-fetch')
  const res = await fetch('https://cdpj.partners.bancointer.com.br/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    agent
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  tokenCache = data.access_token
  tokenExpira = Date.now() + (data.expires_in - 60) * 1000
  return tokenCache
}

export async function gerarQRCode(valor, txid, descricao) {
  if (MOCK_MODE) {
    console.log(`[INTER MOCK] gerarQRCode() — R$ ${valor}`)
    return { txid, qr_code: 'mock-qr', pix_copia_cola: `mock-pix-${txid}`, status: 'ATIVA', valor, mock: true }
  }
  const token = await autenticar()
  const cert = readFileSync(CERT_PATH)
  const key  = readFileSync(KEY_PATH)
  const https = await import('https')
  const agent = new https.Agent({ cert, key, rejectUnauthorized: false })
  const { default: fetch } = await import('node-fetch')
  const res = await fetch(`https://cdpj.partners.bancointer.com.br/pix/v2/cob/${txid}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendario: { expiracao: 1800 },
      valor: { original: valor.toFixed(2) },
      chave: process.env.INTER_CHAVE_PIX,
      solicitacaoPagador: descricao
    }),
    agent
  })
  const cobText = await res.text()
  console.log('[INTER] gerarQRCode resposta:', cobText)
  const cob = JSON.parse(cobText)
  if (!cob.txid) {
    throw new Error(`Inter erro ao criar cobrança: ${cobText}`)
  }
  console.log('[INTER] Cobrança criada:', cob.txid)
  const qrCodeBase64 = await QRCode.toDataURL(cob.pixCopiaECola)
  return {
    txid:           cob.txid,
    qr_code:        qrCodeBase64,
    pix_copia_cola: cob.pixCopiaECola,
    status:         cob.status,
    valor,
    mock:           false
  }
}

export async function enviarPixOut(chave_pix, valor, descricao) {
  if (MOCK_MODE) {
    console.log(`[INTER MOCK] enviarPixOut() — R$ ${valor} → ${chave_pix}`)
    return { id: `mock-${uuidv4()}`, status: 'REALIZADO', valor, chave_pix, mock: true }
  }
  const token = await autenticar()
  const cert = readFileSync(CERT_PATH)
  const key  = readFileSync(KEY_PATH)
  const https = await import('https')
  const agent = new https.Agent({ cert, key, rejectUnauthorized: false })
  const { default: fetch } = await import('node-fetch')
  const res = await fetch('https://cdpj.partners.bancointer.com.br/banking/v2/pix', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valor: valor.toFixed(2),
      destinatario: {
        tipo: 'CHAVE',
        chave: chave_pix
      },
      descricao: descricao
    }),
    agent
  })
  const text = await res.text()
  console.log('[INTER] enviarPixOut resposta:', text)
  let data = {}
  try { data = JSON.parse(text) } catch(e) {}
  return { id: data.endToEndId || text, status: data.status || 'enviado', valor, chave_pix, mock: false }
}

export async function consultarPagamento(txid) {
  if (MOCK_MODE) return { txid, status: 'ATIVA', mock: true }
  const token = await autenticar()
  const cert = readFileSync(CERT_PATH)
  const key  = readFileSync(KEY_PATH)
  const https = await import('https')
  const agent = new https.Agent({ cert, key, rejectUnauthorized: false })
  const { default: fetch } = await import('node-fetch')
  const res = await fetch(`https://cdpj.partners.bancointer.com.br/pix/v2/cob/${txid}`, {
    headers: { 'Authorization': `Bearer ${token}` }, agent
  })
  return await res.json()
}

export async function simularWebhook(txid, valor) {
  if (!MOCK_MODE) throw new Error('simularWebhook só disponível em modo mock')
  return { txid, valor, status: 'CONCLUIDA', simulado: true }
}
