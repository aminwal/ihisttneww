import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY_1': JSON.stringify(env.GEMINI_API_KEY_1),
        'process.env.GEMINI_API_KEY_2': JSON.stringify(env.GEMINI_API_KEY_2),
        'process.env.GEMINI_API_KEY_3': JSON.stringify(env.GEMINI_API_KEY_3),
        'process.env.GEMINI_API_KEY_4': JSON.stringify(env.GEMINI_API_KEY_4),
        'process.env.GEMINI_API_KEY_5': JSON.stringify(env.GEMINI_API_KEY_5)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        chunkSizeWarningLimit: 1600,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('react')) return 'vendor-react';
                if (id.includes('recharts')) return 'vendor-recharts';
                if (id.includes('@supabase')) return 'vendor-supabase';
                if (id.includes('lucide-react')) return 'vendor-lucide';
                if (id.includes('framer-motion')) return 'vendor-motion';
                return 'vendor';
              }
            }
          }
        }
      }
    };
});
