import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        // same-origin /api locally, as CloudFront gives in the cloud, so the SameSite=Strict refresh cookie works (AD-06, AD-08)
        proxy: {
            '/api': 'http://localhost:3001',
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.js'],
        include: ['src/**/*.test.{js,jsx}'],
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{js,jsx}'],
            exclude: ['src/main.jsx', 'src/test/**', 'src/**/*.test.{js,jsx}'],
            // enforced, not reported: a run below target fails (AD-11)
            thresholds: {
                lines: 80,
                branches: 80,
                functions: 80,
                statements: 80,
            },
        },
    },
})
