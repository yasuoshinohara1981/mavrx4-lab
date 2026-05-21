import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    open: false,
    // ブラウザは常に「ページと同じホスト:3000」だけ見ればよい（8080 直は DEV では使わない）
    proxy: {
      '/__osc_ws': {
        target: 'http://127.0.0.1:8080',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  },
  assetsInclude: ['**/*.vert', '**/*.frag', '**/*.glsl', '**/*.hdr']
});

