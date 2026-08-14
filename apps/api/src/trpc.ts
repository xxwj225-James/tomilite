import { initTRPC } from '@trpc/server';
import { z } from 'zod';

export interface Context {
  xApiKey?: string; // from X-Api-Key header
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export { z };
