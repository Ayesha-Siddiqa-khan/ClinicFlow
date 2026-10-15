import { registerOTel } from '@vercel/otel';
import { logger } from './lib/logger';

export async function register() {
  registerOTel({
    serviceName: 'clinic-flow',
  });

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const isPyroscopeEnabled =
      process.env.PYROSCOPE_ENABLED === 'true' ||
      Boolean(process.env.PYROSCOPE_SERVER_ADDRESS);

    if (isPyroscopeEnabled) {
      try {
        const Pyroscope = await import('@pyroscope/nodejs');
        const serverAddress = process.env.PYROSCOPE_SERVER_ADDRESS || 'http://localhost:4040';
        const appName = process.env.PYROSCOPE_APPLICATION_NAME || 'clinic-flow';

        Pyroscope.init({
          serverAddress,
          appName,
          wall: {
            collectCpuTime: true,
          },
          basicAuthUser: process.env.PYROSCOPE_BASIC_AUTH_USER,
          basicAuthPassword: process.env.PYROSCOPE_BASIC_AUTH_PASSWORD,
        });

        Pyroscope.start();
        logger.info('Pyroscope continuous profiling initialized', {
          serverAddress,
          appName,
        });
      } catch (error) {
        logger.warn('Pyroscope continuous profiling failed to initialize', {
          error: (error as Error)?.message || String(error),
        });
      }
    }
  }
}
