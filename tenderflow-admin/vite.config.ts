// `defineConfig` из TanStack Vite-пресета уже подключает плагины ниже — не дублируйте вручную,
// иначе сломается сборка (дубликаты):
//   tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only, optional),
//   componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//   error logger plugins, sandbox detection (port/host/strictPort).
// Доп. настройки: defineConfig({ vite: { ... } }).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

export default defineConfig({
  tanstackStart: { target: "node-server" },
  cloudflare: false,
  // Деплой: Nitro + node-server preset. Приложение в основном CSR (`defaultSsr: false`).
  plugins: [nitro({ preset: "node-server" })],
});
