import { defineConfig } from 'cypress'

// runs against the local stack: `npm run dev` on :3000 proxying /api to :3001 (AD-06)
export default defineConfig({
    e2e: {
        baseUrl: 'http://localhost:3000',
        specPattern: 'cypress/e2e/**/*.cy.js',
        supportFile: false,
        video: false,
        viewportWidth: 1280,
        viewportHeight: 900,
    },
})
