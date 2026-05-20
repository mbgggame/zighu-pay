import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { v4 as uuidv4 } from 'uuid'
import dotenv from 'dotenv'

dotenv.config()

const MOCK_MODE = process.env.INTER_ENV === 'mock'

// ─── TOKEN DE ACESSO ──────────────────────────────────────────────────────────
let tokenCache = null
let tokenExpira = null

async function autenticar() {
  if (MOCK_MODE) {
    console.log('[INTER MOCK] autenticar() — retornando token simulado')
    return 'mock-token-zighu-pay'
  }

  if (tokenCache && tokenExpira && Date.now() < tokenExpira) {
    return tokenCache
  }

  try {
    let cert, key
    if (process.env.INTER_CERT_BASE64) {
      const certStr = Buffer.from(process.env.INTER_CERT_BASE64, 'base64').toString('utf8')
      cert = certStr.includes('-----') ? certStr : certStr.replace(/(.{64})/g, '$1\n')
    } else {
      cert = readFileSync(process.env.INTER_CERT_PATH)
    }
    if (process.env.INTER_KEY_BASE64) {
      const keyStr = Buffer.from(process.env.INTER_KEY_BASE64, 'base64').toString('utf8')
      key = keyStr.includes('-----') ? keyStr : keyStr.replace(/(.{64})/g, '$1\n')
    } else {
      key = readFileSync(process.env.INTER_KEY_PATH)
    }

    const params = new URLSearchParams({
      client_id: process.env.INTER_CLIENT_ID,
      client_secret: process.env.INTER_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'pix.read pix.write'
    })

    const https = await import('https')
    const agent = new https.Agent({ cert, key })

    const { default: fetch } = await import('node-fetch')
    const res = await fetch('https://cdpj.partners.bancointer.com.br/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      agent
    })

    const data = await res.json()
    tokenCache = data.access_token
    tokenExpira = Date.now() + (data.expires_in - 60) * 1000
    return tokenCache
  } catch (err) {
    console.error('[INTER] Erro ao autenticar:', err.message)
    throw err
  }
}

// ─── GERAR QR CODE PIX ───────────────────────────────────────────────────────
async function gerarQRCode(valor, txid, descricao) {
  if (MOCK_MODE) {
    console.log(`[INTER MOCK] gerarQRCode() — valor: R$ ${valor} | txid: ${txid}`)
    const pixFake = `00020101021226870014br.gov.bcb.pix2565pix.inter.com.br/cobv/${txid}5204000053039865406${valor.toFixed(2).replace('.', '')}5802BR5913ZighuPay6008Vitoria62070503***6304ABCD`
    return {
      txid,
      qrcode: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
      pixCopiaECola: pixFake,
      status: 'ATIVA',
      valor,
      mock: true
    }
  }

  try {
    const token = await autenticar()
    let cert, key
    if (process.env.INTER_CERT_BASE64) {
      const certStr = Buffer.from(process.env.INTER_CERT_BASE64, 'base64').toString('utf8')
      cert = certStr.includes('-----') ? certStr : certStr.replace(/(.{64})/g, '$1\n')
    } else {
      cert = readFileSync(process.env.INTER_CERT_PATH)
    }
    if (process.env.INTER_KEY_BASE64) {
      const keyStr = Buffer.from(process.env.INTER_KEY_BASE64, 'base64').toString('utf8')
      key = keyStr.includes('-----') ? keyStr : keyStr.replace(/(.{64})/g, '$1\n')
    } else {
      key = readFileSync(process.env.INTER_KEY_PATH)
    }
    const https = await import('https')
    const agent = new https.Agent({ cert, key })
    const { default: fetch } = await import('node-fetch')

    const vencimento = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const res = await fetch(`https://cdpj.partners.bancointer.com.br/pix/v2/cob/${txid}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        calendario: { expiracao: 1800 },
        valor: { original: valor.toFixed(2) },
        chave: process.env.INTER_CHAVE_PIX || process.env.INTER_CONTA_CORRENTE,
        solicitacaoPagador: descricao
      }),
      agent
    })

    const cob = await res.json()

    // Buscar QR Code
    const resQr = await fetch(`https://cdpj.partners.bancointer.com.br/pix/v2/loc/${cob.loc.id}/qrcode`, {
      headers: { 'Authorization': `Bearer ${token}` },
      agent
    })
    const qr = await resQr.json()

    return {
      txid: cob.txid,
      qr_code: qr.imagemQrcode,
      pix_copia_cola: qr.qrcode,
      status: cob.status,
      valor,
      mock: false
    }
  } catch (err) {
    console.error('[INTER] Erro ao gerar QR Code:', err.message)
    throw err
  }
}

// ─── PIX OUT (REPASSE AO MOTORISTA) ──────────────────────────────────────────
async function enviarPixOut(chave_pix, valor, descricao, txid_ref) {
  if (MOCK_MODE) {
    console.log(`[INTER MOCK] enviarPixOut() — chave: ${chave_pix} | valor: R$ ${valor}`)
    return {
      endToEndId: `mock-pixout-${uuidv4()}`,
      status: 'REALIZADO',
      valor,
      chave_pix,
      mock: true
    }
  }

  try {
    const token = await autenticar()
    let cert, key
    if (process.env.INTER_CERT_BASE64) {
      const certStr = Buffer.from(process.env.INTER_CERT_BASE64, 'base64').toString('utf8')
      cert = certStr.includes('-----') ? certStr : certStr.replace(/(.{64})/g, '$1\n')
    } else {
      cert = readFileSync(process.env.INTER_CERT_PATH)
    }
    if (process.env.INTER_KEY_BASE64) {
      const keyStr = Buffer.from(process.env.INTER_KEY_BASE64, 'base64').toString('utf8')
      key = keyStr.includes('-----') ? keyStr : keyStr.replace(/(.{64})/g, '$1\n')
    } else {
      key = readFileSync(process.env.INTER_KEY_PATH)
    }
    const https = await import('https')
    const agent = new https.Agent({ cert, key })
    const { default: fetch } = await import('node-fetch')

    const res = await fetch('https://cdpj.partners.bancointer.com.br/pix/v2/pix', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        valor: valor.toFixed(2),
        chave: chave_pix,
        descricao: descricao
      }),
      agent
    })

    const data = await res.json()
    return {
      id: data.endToEndId,
      status: data.status,
      valor,
      chave_pix,
      mock: false
    }
  } catch (err) {
    console.error('[INTER] Erro ao enviar Pix Out:', err.message)
    throw err
  }
}

// ─── CONSULTAR PAGAMENTO ──────────────────────────────────────────────────────
async function consultarPagamento(txid) {
  if (MOCK_MODE) {
    console.log(`[INTER MOCK] consultarPagamento() — txid: ${txid}`)
    return {
      txid,
      status: 'ATIVA',
      valor: null,
      mock: true
    }
  }

  try {
    const token = await autenticar()
    let cert, key
    if (process.env.INTER_CERT_BASE64) {
      const certStr = Buffer.from(process.env.INTER_CERT_BASE64, 'base64').toString('utf8')
      cert = certStr.includes('-----') ? certStr : certStr.replace(/(.{64})/g, '$1\n')
    } else {
      cert = readFileSync(process.env.INTER_CERT_PATH)
    }
    if (process.env.INTER_KEY_BASE64) {
      const keyStr = Buffer.from(process.env.INTER_KEY_BASE64, 'base64').toString('utf8')
      key = keyStr.includes('-----') ? keyStr : keyStr.replace(/(.{64})/g, '$1\n')
    } else {
      key = readFileSync(process.env.INTER_KEY_PATH)
    }
    const https = await import('https')
    const agent = new https.Agent({ cert, key })
    const { default: fetch } = await import('node-fetch')

    const res = await fetch(`https://cdpj.partners.bancointer.com.br/pix/v2/cob/${txid}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      agent
    })

    return await res.json()
  } catch (err) {
    console.error('[INTER] Erro ao consultar pagamento:', err.message)
    throw err
  }
}

// ─── SIMULAR WEBHOOK (apenas mock) ───────────────────────────────────────────
async function simularWebhook(txid, valor) {
  if (!MOCK_MODE) throw new Error('simularWebhook só disponível em modo mock')
  console.log(`[INTER MOCK] simularWebhook() — txid: ${txid} | valor: R$ ${valor}`)
  return {
    txid,
    valor,
    status: 'CONCLUIDA',
    simulado: true
  }
}

export { autenticar, gerarQRCode, enviarPixOut, consultarPagamento, simularWebhook, MOCK_MODE }
