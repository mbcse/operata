import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";

import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
// import { } from "./authModel";
import { validateRequest } from "@/common/utils/httpHandlers";
import { handleNotionAuthCallback } from "./authController";

export const authRouter: Router = express.Router();


authRouter.post("/callback", handleNotionAuthCallback);

