# Zighu Pay

Gateway de pagamentos Pix com split automático para o MobiHub.

## O que é o Zighu Pay?

O Zighu Pay é um microsserviço de pagamentos independente, plug-and-play, que integra com o Banco Inter para:
- Gerar QR Codes Pix para cobranças
- Receber confirmações de pagamento via webhook
- Realizar split automático entre motorista e plataforma
- Enviar Pix Out para motoristas
- Notificar apps clientes sobre status de pagamentos

## Como integrar

### Gerar uma cobrança

```bash
POST /zighu/cobranca
Header: x-api-key: SUA_API_KEY

Body:
{
  "corrida_id": 123,
  "valor": 50.00,
  "motorista_id": 456,
  "chave_pix": "12345678909",
  "percentual_motorista": 82,
  "app_origem": "mobihub"
}

Resposta:
{
  "cobranca_id": 1,
  "qr_code": "data:image/png;base64,...",
  "pix_copia_cola": "00020126580014br.gov.bcb.pix...",
  "txid": "abc123...",
  "status": "aguardando_pagamento"
}
```

### Consultar status de uma cobrança

```bash
GET /zighu/cobranca/:corrida_id
Header: x-api-key: SUA_API_KEY

Resposta:
{
  "status": "pago",
  "pago_em": "2026-05-19T20:00:00.000Z",
  "valor_motorista": 41.00,
  "valor_plataforma": 9.00
}
```

## Como configurar o Banco Inter

1. Acesse o portal de desenvolvedores do Banco Inter
2. Crie uma aplicação e obtenha:
   - Client ID
   - Client Secret
   - Certificado (.crt)
   - Chave privada (.key)
3. Coloque os certificados na pasta `certs/`
4. Configure as variáveis de ambiente no `.env`

## Como adicionar novos apps clientes

1. Insira um novo registro na tabela `apps_clientes`:
```sql
INSERT INTO apps_clientes (nome, api_key, callback_url) 
VALUES ('meuapp', 'minha-api-key-secreta', 'https://meuapp.com/callback');
```

## Variáveis de ambiente necessárias

Veja o arquivo `.env.example` para a lista completa de variáveis.
