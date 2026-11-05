import { createApi } from './api.js';
import { fileURLToPath } from 'node:url';

const { server, closeDatabase } = createApi({
  databasePath: process.env.DATABASE_PATH || '/data/mistakes.sqlite',
  loginPassword: process.env.LOGIN_PASSWORD,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
  trustFlyProxy: Boolean(process.env.FLY_APP_NAME),
  staticDirectory: process.env.STATIC_DIRECTORY || fileURLToPath(new URL('../', import.meta.url)),
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Mistake sync API listening'));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => { closeDatabase(); process.exit(0); }));
}
