import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pino } from "pino";

import { openAPIRouter } from "@/api-docs/openAPIRouter";
import { healthCheckRouter } from "@/api/healthCheck/healthCheckRouter";
import errorHandler from "@/common/middleware/errorHandler";
import rateLimiter from "@/common/middleware/rateLimiter";
import requestLogger from "@/common/middleware/requestLogger";
import { env } from "@/common/utils/envConfig";
import { elizaRouter } from "./api/eliza/elizaRouter";
import { authRouter } from "./api/notion/auth/authRouter";
import { webhookRouter } from "./api/notion/webhook/webhookRouter";

const logger = pino({ name: "server start" });
const app: Express = express();

// Set the application to trust the reverse proxy
app.set("trust proxy", true);
const originArray = env.CORS_ORIGIN.split(",");

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin:function (origin, callback) {
    if (!origin || originArray.includes(origin.trim())) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }, credentials: true }));app.use(helmet());
app.use(rateLimiter);

// Request logging
app.use(requestLogger);

// Routes
app.use("/health-check", healthCheckRouter);
app.use("/eliza", elizaRouter);
app.use("/notion/auth", authRouter)
app.use("/notion/webhook", webhookRouter)

// Swagger UI
app.use(openAPIRouter);

// Error handlers
app.use(errorHandler());

export { app, logger };
