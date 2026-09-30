import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleFollowUp } from './server/followUpHandler.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'api-follow-up-endpoint',
        configureServer(server) {
          server.middlewares.use('/api/follow-up', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }))
              return
            }

            let body = ''
            req.on('data', chunk => {
              body += chunk
            })

            req.on('end', async () => {
              try {
                const data = JSON.parse(body || '{}')
                const result = await handleFollowUp({
                  ...data,
                  envApiKey: env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY,
                })
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(result))
              } catch (err) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: err?.message || 'Internal server error' }))
              }
            })
          })
        },
      },
    ],
  }
})
