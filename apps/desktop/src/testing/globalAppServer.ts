import { SHARED_APP_SERVER, startAppServer } from "./appServer";

/** Vitest's global setup: starts the one Vite server every test file's browser loads the App from (`appServer`). */
export default async function globalAppServer(): Promise<() => Promise<void>> {
  const server = await startAppServer();

  process.env[SHARED_APP_SERVER] = JSON.stringify({ root: process.cwd(), origin: server.resolvedUrls.local[0] });

  return () => server.close();
}
