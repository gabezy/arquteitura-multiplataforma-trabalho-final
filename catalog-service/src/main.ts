import { loadConfig } from './infra/config/env';
import { createLogger } from './infra/observability/logger';
import { createApp } from './infra/http/app';

const config = loadConfig();
const logger = createLogger(config.logLevel);

createApp(logger).listen(config.port, () => {
  logger.info({ port: config.port }, `${config.serviceName} listening`);
});
