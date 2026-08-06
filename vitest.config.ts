import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    poolOptions: {
      workers: {
        // SQLite-backed Durable Objects + per-test isolated storage is
        // unreliable on Windows (file locks during storage-stack resets).
        // Tests mint unique DO ids, so shared storage is safe.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: "./test/wrangler.test.jsonc" },
      },
    },
  },
});
