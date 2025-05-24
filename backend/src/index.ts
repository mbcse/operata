import { env } from "@/common/utils/envConfig";
import { app, logger } from "@/server";
import { balanceSyncScheduler } from './common/utils/balanceSync';
import { transactionMonitor } from './common/utils/transactionMonitor';
import { registerAnalyzeWorkers } from './api/notion/webhook/webhookQueue';

const server = app.listen(env.PORT, () => {
  const { NODE_ENV, HOST, PORT } = env;
  logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`);
});

const onCloseSignal = () => {
  logger.info("sigint received, shutting down");
  server.close(() => {
    logger.info("server closed");
    process.exit();
  });
  setTimeout(() => process.exit(1), 10000).unref(); // Force shutdown after 10s
};

process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);

// Start the balance sync scheduler
balanceSyncScheduler.start().catch((error) => {
    logger.error('Application', 'Failed to start balance sync scheduler', { error });
});

// Start the transaction monitor
transactionMonitor.start().catch((error) => {
    logger.error('Application', 'Failed to start transaction monitor', { error });
});

// Register the analyze workers
registerAnalyzeWorkers().catch((error) => {
    logger.error('Application', 'Failed to register analyze workers', { error });
});
