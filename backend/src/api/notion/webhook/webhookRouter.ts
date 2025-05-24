import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";

import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
// import { } from "./authModel";
import { validateRequest } from "@/common/utils/httpHandlers";
import { handleNotionWebhook } from "./webhookController";

export const webhookRouter: Router = express.Router();


webhookRouter.post("/", handleNotionWebhook);