import { registerOTel } from '@vercel/otel';
import { logger } from './lib/logger';
import { profiler } from './lib/profiler';

export async function register() {
  registerOTel({
    serviceName: 'clinic-flow',
  });

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    profiler.start();
    logger.info('Observability instrumentation initialized for ClinicFlow');
  }
}
