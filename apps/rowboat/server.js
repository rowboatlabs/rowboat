import express from 'express'
import next from 'next'
import { MongoClient } from 'mongodb'
import { createServer } from 'http'

// Create Express server
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()
const port = parseInt(process.env.PORT || '3000', 10)
const hostname = '0.0.0.0'

console.log(`Starting server with configuration:
- NODE_ENV: ${process.env.NODE_ENV}
- PORT: ${port}
- HOSTNAME: ${hostname}
- MONGODB_CONNECTION_STRING: ${process.env.MONGODB_CONNECTION_STRING ? 'set' : 'not set'}
`)

// Prepare the server
app.prepare().then(async () => {
  try {
    const server = express()
    const mongoClient = new MongoClient(process.env.MONGODB_CONNECTION_STRING)

    try {
      await mongoClient.connect()
      console.log('Connected to MongoDB')
    } catch (error) {
      console.error('MongoDB connection error:', error)
      // Don't throw here, we can still start the server
    }

    // Let Next.js handle all routes
    server.all('*', (req, res) => {
      return handle(req, res)
    })

    const httpServer = createServer(server)
    
    // Add error handling for the server
    httpServer.on('error', (error) => {
      console.error('Server error:', error)
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use`)
        process.exit(1)
      }
    })

    // Add connection handling
    httpServer.on('connection', (socket) => {
      console.log('New connection from:', socket.remoteAddress)
    })

    // Start the server
    httpServer.listen(port, hostname, () => {
      console.log(`> Server is ready and listening on http://${hostname}:${port}`)
    })

  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}).catch((error) => {
  console.error('Failed to prepare Next.js app:', error)
  process.exit(1)
}) 