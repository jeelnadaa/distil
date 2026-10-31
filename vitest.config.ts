import { defineConfig } from "vitest/config";

// Server and logic tests run in Node with no UI build and no network.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
