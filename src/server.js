import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fastifyStatic from '@fastify/static'
import { initializeDatabase, pool } from './db.js';
import cobrancasRoutes from './routes/cobrancas.js';
import webhookRoutes from './routes/webhook.js';
import splitRoutes from './routes/split.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const fastify = Fastify({ logger: true });

fastify.register(cors);

fastify.register(fastifyStatic, {
  root: join(__dirname, '../public'),
  prefix: '/'
})

fastify.addHook('preHandler', async (request, reply) => {
  const publicRoutes = ['/zighu/webhook/inter', '/zighu/health', '/admin', '/admin/index.html'];
  if (publicRoutes.includes(request.routerPath) || request.routerPath.startsWith('/admin')) {
    return;
  }

  const apiKey = request.headers['x-api-key'];
  if (!apiKey) {
    return reply.status(401).send({ error: 'API Key não fornecida' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id FROM apps_clientes WHERE api_key = $1 AND ativo = true',
      [apiKey]
    );
    if (result.rows.length === 0) {
      return reply.status(403).send({ error: 'API Key inválida' });
    }
  } finally {
    client.release();
  }
});

fastify.register(cobrancasRoutes);
fastify.register(webhookRoutes);
fastify.register(splitRoutes);

const start = async () => {
  try {
    await initializeDatabase();
    const port = process.env.PORT || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Servidor rodando na porta ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
