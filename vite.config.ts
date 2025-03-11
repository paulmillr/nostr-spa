import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), vueJsx()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
    minify: false,
    // sourcemap: true,
    assetsDir: 'assets',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name) {
            const extType = assetInfo.name.split('.').at(1)
            if (extType === 'css') return `main.css`
          }
          return 'assets/[name][extname]'
        },
      },
    },
    cssCodeSplit: false,
    outDir: 'dist',
  },
  base: './',
})
