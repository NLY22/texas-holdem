import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 关键配置：确保在 GitHub Pages 二级子路径下资源能正常加载
  server: {
    host: true,
    port: 3000
  }
});
