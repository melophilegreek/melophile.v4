import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `process` is a genuine Node global available at runtime here (Vite config
// files execute under Node), but this project has no `@types/node` installed,
// so `tsc -b` failed with "Cannot find name 'process'" (TS2580). Installing
// @types/node would mean updating package-lock.json too, which isn't
// necessary just for this one line — declaring the small shape we actually
// use satisfies the type-checker without adding a dependency.
declare const process: { env: Record<string, string | undefined> }

// The GitHub Pages workflow always sets VITE_BASE_PATH explicitly (to
// '/melophile.v4/', matching the repo name), so this fallback only kicks in
// for other build contexts -- local dev, and now the Capacitor/Android
// build, both of which serve index.html from the root of their own origin
// and need root-relative paths, not a GH-Pages-specific subpath.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
})
