import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { localDebug } from "./scripts/local-debug";

export default defineConfig(({ command, mode }) => ({
  plugins: command === 'serve' && mode === 'debug'
    ? [localDebug(), vinext()]
    : [vinext(), cloudflare()],
}));
