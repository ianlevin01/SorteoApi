import OpenAI from 'openai';
import { env } from './env.js';

let client = null;

/** Devuelve el cliente de OpenAI, o null si no hay API key configurada. */
export function getOpenAI() {
  if (!env.openai.apiKey) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: env.openai.apiKey,
      timeout: env.openai.timeoutMs,
      maxRetries: 1,
    });
  }
  return client;
}
