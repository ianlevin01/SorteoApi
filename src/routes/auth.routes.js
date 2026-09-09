import { Router } from 'express';
import { validate } from '../lib/validate.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { checkDniSchema, loginSchema, registerSchema } from '../schemas/auth.schema.js';
import * as authService from '../services/authService.js';

export const authRouter = Router();

// Dice si un DNI ya esta registrado (para el flujo "desbloquear el resto").
authRouter.post(
  '/check',
  validate(checkDniSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.checkDni(req.valid.body.dni));
  }),
);

authRouter.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await authService.register(req.valid.body));
  }),
);

authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.login(req.valid.body.dni));
  }),
);
