import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/pdfjs-dist')) return 'pdf';
          if (id.includes('node_modules/tesseract.js')) return 'ocr';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
