import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleFollowUp } from './server/followUpHandler.js'
import { handleAnalysis } from './server/analysisHandler.js'
import { handleLogSave, handleProofRetry } from './server/logHandler.js'

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

          server.middlewares.use('/api/analyze', async (req, res) => {
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
                const result = await handleAnalysis({
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

          server.middlewares.use('/api/logs', async (req, res) => {
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
                if (data.action === 'retry-proof' || data.retry) {
                  const retryResult = await handleProofRetry({
                    logId: data.logId,
                    log: data.log || {},
                    language: data.language || 'en-IN',
                  })
                  res.statusCode = 200
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify(retryResult))
                  return
                }

                const result = await handleLogSave({
                  log: data.log || {},
                  language: data.language || 'en-IN',
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
