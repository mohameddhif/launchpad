import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_ORIGIN ?? "http://localhost:4100", changeOrigin: true },
      "/webhooks": { target: process.env.API_ORIGIN ?? "http://localhost:4100", changeOrigin: true },
      "/ws": { target: process.env.API_ORIGIN ?? "http://localhost:4100", ws: true, changeOrigin: true },
    },
  },
});
