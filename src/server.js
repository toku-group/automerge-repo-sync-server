import 'dotenv/config'
console.log(process.env)

// @ts-check
import fs from "fs"
import express from "express"
import { WebSocketServer } from "ws"
import { Repo } from "@automerge/automerge-repo"
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"
import { R2StorageAdapter } from "./storage/R2StorageAdapter.js"
import os from "os"

export class Server {
  /** @type WebSocketServer */
  #socket

  /** @type ReturnType<import("express").Express["listen"]> */
  #server

  /** @type {((value: any) => void)[]} */
  #readyResolvers = []

  #isReady = false

  /** @type Repo */
  #repo

  /** @type {*} */
  #storageAdapter

  constructor() {
    var hostname = os.hostname()

    // Configure WebSocket server with resource limits
    const maxConnections = process.env.MAX_CONNECTIONS ? parseInt(process.env.MAX_CONNECTIONS) : 100
    const heartbeatInterval = process.env.HEARTBEAT_INTERVAL ? parseInt(process.env.HEARTBEAT_INTERVAL) : 30000
    
    this.#socket = new WebSocketServer({ 
      noServer: true,
      maxPayload: 16 * 1024 * 1024, // 16MB max payload
      skipUTF8Validation: false,
      perMessageDeflate: {
        zlibDeflateOptions: {
          chunkSize: 4096,
          windowBits: 13,
          memLevel: 7,
        },
        zlibInflateOptions: {
          chunkSize: 4096,
          windowBits: 13,
          memLevel: 7,
        },
        threshold: 1024,
        concurrencyLimit: 10,
      }
    })

    // Track active connections
    let activeConnections = 0
    const connectionLimit = maxConnections

    // Set up connection monitoring
    this.#socket.on('connection', (ws, request) => {
      activeConnections++
      console.log(`New connection established. Active connections: ${activeConnections}`)
      
      // Check connection limit
      if (activeConnections > connectionLimit) {
        console.warn(`Connection limit exceeded (${connectionLimit}). Closing connection.`)
        ws.close(1008, 'Server overloaded')
        return
      }

      // Set up heartbeat
      ws.isAlive = true
      ws.on('pong', () => {
        ws.isAlive = true
      })

      // Handle connection close
      ws.on('close', () => {
        activeConnections--
        console.log(`Connection closed. Active connections: ${activeConnections}`)
      })

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error)
        activeConnections--
      })
    })

    // Set up heartbeat interval
    const heartbeat = setInterval(() => {
      this.#socket.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.terminate()
          return
        }
        ws.isAlive = false
        ws.ping()
      })
    }, heartbeatInterval)

    // Clean up heartbeat on server close
    this.#socket.on('close', () => {
      clearInterval(heartbeat)
    })

    const PORT =
      process.env.PORT !== undefined ? parseInt(process.env.PORT) : 3030
    const app = express()
    app.use(express.static("public"))
    app.use(express.json())

    // Configure CORS
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
      : ['http://localhost:3000', 'http://localhost:5173']

    app.use((req, res, next) => {
      const origin = req.headers.origin
      
      // Check if origin is allowed
      let isAllowed = false
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        isAllowed = true
      } else {
        // Check for wildcard patterns
        for (const allowedOrigin of allowedOrigins) {
          if (allowedOrigin.includes('*')) {
            const pattern = allowedOrigin.replace(/\*/g, '.*')
            const regex = new RegExp(`^${pattern}$`)
            if (regex.test(origin)) {
              isAllowed = true
              break
            }
          }
        }
        
        // Also allow devtunnels.ms domains for development
        if (origin && origin.includes('.devtunnels.ms')) {
          isAllowed = true
        }
      }
      
      if (isAllowed) {
        res.header('Access-Control-Allow-Origin', origin)
      }
      
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
      res.header('Access-Control-Allow-Credentials', 'true')
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.sendStatus(200)
        return
      }
      
      next()
    })

    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`)
    console.log(process.env.NODE_ENV);

    // Configure storage adapter based on environment variables
    let storageAdapter
    if (process.env.USE_R2_STORAGE === "true") {
      // R2 storage configuration
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || 
          !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET_NAME) {
        throw new Error("R2 storage requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables")
      }
      
      storageAdapter = new R2StorageAdapter({
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucket: process.env.R2_BUCKET_NAME,
        prefix: process.env.R2_PREFIX || "automerge-repo"
      })
      
      console.log(`Using R2 storage: ${process.env.R2_BUCKET_NAME}`)
    } else {
      // Default to filesystem storage
      const dir =
        process.env.DATA_DIR !== undefined ? process.env.DATA_DIR : ".amrg"
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir)
      }
      storageAdapter = new NodeFSStorageAdapter(dir)
      console.log(`Using filesystem storage: ${dir}`)
    }

    // Store the storage adapter for later access
    this.#storageAdapter = storageAdapter

    const config = {
      network: [new NodeWSServerAdapter(this.#socket)],
      storage: storageAdapter,
      /** @ts-ignore @type {(import("@automerge/automerge-repo").PeerId)}  */
      peerId: `storage-server-${hostname}`,
      // Since this is a server, we don't share generously — meaning we only sync documents they already
      // know about and can ask for by ID.
      sharePolicy: async () => false,
    }
    this.#repo = new Repo(config)

    app.get("/", (req, res) => {
      res.send(`👍 @automerge/automerge-repo-sync-server is running`)
    })

    // API endpoint to list all projects
    app.get("/api/projects", async (req, res) => {
      try {
        const projects = []
        
        const documentIds = await this.getAllDocumentIds(this.#storageAdapter)
        
        // Process each document to extract project information
        for (const documentId of documentIds) {
          try {
            const handle = this.#repo.find(documentId)
            await handle.whenReady()
            
            if (handle.docSync()) {
              const doc = handle.docSync()
              const project = this.extractProjectInfo(documentId, doc)
              if (project) {
                projects.push(project)
              }
            }
          } catch (docError) {
            console.warn(`Error processing document ${documentId}:`, docError.message)
            // Continue processing other documents
          }
        }
        
        res.json({ projects })
      } catch (error) {
        console.error('Error fetching projects:', error)
        res.status(500).json({ error: 'Failed to fetch projects' })
      }
    })

    // API endpoint to get a specific project document
    app.get("/api/project/:projectId", async (req, res) => {
      try {
        const { projectId } = req.params
        
        const handle = this.#repo.find(projectId)
        await handle.whenReady()
        
        if (!handle.docSync()) {
          return res.status(404).json({ error: 'Project not found' })
        }
        
        const doc = handle.docSync()
        res.json({
          projectId,
          document: doc,
          heads: handle.heads(),
          lastModified: this.getLastModified(doc)
        })
      } catch (error) {
        console.error('Error fetching project:', error)
        if (error.message && error.message.includes('not found')) {
          res.status(404).json({ error: 'Project not found' })
        } else {
          res.status(500).json({ error: 'Failed to fetch project' })
        }
      }
    })

    // API endpoint to create a new project
    app.post("/api/projects", async (req, res) => {
      try {
        const { name, description } = req.body
        
        // Validate required fields
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'Project name is required and must be a non-empty string' })
        }
        
        // Create a new document handle
        const handle = this.#repo.create()
        
        // Initialize the document with project data
        handle.change(doc => {
          doc.name = name.trim()
          if (description && typeof description === 'string') {
            doc.description = description.trim()
          }
          doc.createdAt = new Date().toISOString()
          doc.lastModified = new Date().toISOString()
          doc.nodes = [] // Initialize with empty nodes array
        })
        
        // Wait for the document to be ready
        await handle.whenReady()
        
        const projectId = handle.documentId
        const doc = handle.docSync()
        
        console.log(`Created new project: ${projectId} (${name})`)
        
        res.status(201).json({
          projectId,
          document: doc,
          heads: handle.heads(),
          lastModified: this.getLastModified(doc)
        })
      } catch (error) {
        console.error('Error creating project:', error)
        res.status(500).json({ error: 'Failed to create project' })
      }
    })

    this.#server = app.listen(PORT, () => {
      console.log(`Listening on port ${PORT}`)
      console.log(`Max connections: ${maxConnections}`)
      console.log(`Heartbeat interval: ${heartbeatInterval}ms`)
      this.#isReady = true
      this.#readyResolvers.forEach((resolve) => resolve(true))
    })

    this.#server.on("upgrade", (request, socket, head) => {
      this.#socket.handleUpgrade(request, socket, head, (socket) => {
        this.#socket.emit("connection", socket, request)
      })
    })

    // Handle server errors
    this.#server.on('error', (error) => {
      console.error('Server error:', error)
    })

    // Graceful shutdown handling
    const gracefulShutdown = () => {
      console.log('Received shutdown signal, closing server gracefully...')
      this.close()
      process.exit(0)
    }

    process.on('SIGTERM', gracefulShutdown)
    process.on('SIGINT', gracefulShutdown)
  }

  async ready() {
    if (this.#isReady) {
      return true
    }

    return new Promise((resolve) => {
      this.#readyResolvers.push(resolve)
    })
  }

  close() {
    this.#socket.close()
    this.#server.close()
  }

  /**
   * Get all document IDs from the storage adapter
   * @param {*} storageAdapter 
   * @returns {Promise<string[]>}
   */
  async getAllDocumentIds(storageAdapter) {
    try {
      if (storageAdapter instanceof R2StorageAdapter) {
        // For R2 storage, use the custom method
        return await storageAdapter.getAllDocumentIds()
      } else if (storageAdapter instanceof NodeFSStorageAdapter) {
        // For filesystem storage, scan the directory structure
        const dir = storageAdapter.path || '.amrg'
        return await this.scanFilesystemForDocuments(dir)
      } else {
        // Fallback: try to get from repo's document cache - handles is a Map
        const handles = this.#repo.handles
        if (handles && typeof handles.keys === 'function') {
          return Array.from(handles.keys())
        } else {
          console.warn('Repository handles not accessible, returning empty array')
          return []
        }
      }
    } catch (error) {
      console.warn('Error getting document IDs:', error)
      return []
    }
  }

  /**
   * Scan filesystem for automerge documents
   * @param {string} dir 
   * @returns {Promise<string[]>}
   */
  async scanFilesystemForDocuments(dir) {
    const documentIds = []
    
    try {
      if (!fs.existsSync(dir)) {
        return documentIds
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = `${dir}/${entry.name}`
          const subEntries = fs.readdirSync(subDir, { withFileTypes: true })
          
          for (const subEntry of subEntries) {
            if (subEntry.isDirectory()) {
              // This should be a document ID directory
              const documentId = subEntry.name
              const snapshotPath = `${subDir}/${documentId}/snapshot`
              
              if (fs.existsSync(snapshotPath)) {
                documentIds.push(documentId)
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Error scanning filesystem for documents:', error)
    }
    
    return documentIds
  }

  /**
   * Extract project information from an automerge document
   * @param {string} documentId 
   * @param {*} doc 
   * @returns {Project | null}
   */
  extractProjectInfo(documentId, doc) {
    try {
      // Try to extract common project fields
      const project = {
        id: documentId,
        name: doc.name || doc.title || documentId,
        description: doc.description || undefined,
        lastModified: this.getLastModified(doc),
        nodeCount: this.getNodeCount(doc)
      }
      
      return project
    } catch (error) {
      console.warn(`Error extracting project info for ${documentId}:`, error)
      return null
    }
  }

  /**
   * Get the last modified timestamp from a document
   * @param {*} doc 
   * @returns {string | undefined}
   */
  getLastModified(doc) {
    try {
      // Try to find timestamp fields in the document
      if (doc.lastModified) {
        return new Date(doc.lastModified).toISOString()
      }
      if (doc.updatedAt) {
        return new Date(doc.updatedAt).toISOString()
      }
      if (doc.modified) {
        return new Date(doc.modified).toISOString()
      }
      
      // If no explicit timestamp, we could try to get it from automerge metadata
      // This is a placeholder - actual implementation would depend on how you track modifications
      return new Date().toISOString()
    } catch (error) {
      return undefined
    }
  }

  /**
   * Count nodes/elements in the document
   * @param {*} doc 
   * @returns {number | undefined}
   */
  getNodeCount(doc) {
    try {
      // Count top-level properties or nodes
      if (typeof doc === 'object' && doc !== null) {
        if (Array.isArray(doc.nodes)) {
          return doc.nodes.length
        }
        if (Array.isArray(doc.items)) {
          return doc.items.length
        }
        if (Array.isArray(doc.elements)) {
          return doc.elements.length
        }
        
        // Fallback: count top-level keys
        return Object.keys(doc).length
      }
      
      return undefined
    } catch (error) {
      return undefined
    }
  }
}
