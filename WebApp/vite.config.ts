import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'build',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-mapbox': ['mapbox-gl'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable', 'html2canvas'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});