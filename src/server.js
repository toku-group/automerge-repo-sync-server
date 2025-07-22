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
import swaggerJsdoc from "swagger-jsdoc"
import swaggerUi from "swagger-ui-express"
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
      
      // Always allow requests to API documentation
      if (req.path.startsWith('/api-docs')) {
        isAllowed = true
      } else if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
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
        
        // Allow localhost for development
        if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          isAllowed = true
        }
      }
      
      if (isAllowed) {
        res.header('Access-Control-Allow-Origin', origin || '*')
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

    // Configure Swagger/OpenAPI documentation
    const swaggerOptions = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'Automerge Repo Sync Server API',
          version: '0.2.8',
          description: 'A collaborative document sync server using Automerge CRDT with REST API for project management and WebSocket for real-time synchronization.',
          contact: {
            name: 'Toku Group',
            url: 'https://tokugroup.com'
          }
        },
        servers: [
          {
            url: `http://localhost:${PORT}`,
            description: 'Local development server'
          },
          {
            url: process.env.SERVER_HOST ? `https://${process.env.SERVER_HOST}` : `http://localhost:${PORT}`,
            description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
          }
        ],
        components: {
          schemas: {
            Project: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Unique project identifier (automerge document ID)',
                  example: '2h8kDmTxXBV7E6HdUzu9Pu3FQ7Qd'
                },
                name: {
                  type: 'string',
                  description: 'Project name',
                  example: 'My Project'
                },
                description: {
                  type: 'string',
                  nullable: true,
                  description: 'Optional project description',
                  example: 'A collaborative project'
                },
                lastModified: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true,
                  description: 'Last modification timestamp',
                  example: '2025-07-18T19:47:38.565Z'
                },
                nodeCount: {
                  type: 'integer',
                  nullable: true,
                  description: 'Number of nodes/elements in the project',
                  example: 5
                }
              },
              required: ['id', 'name']
            },
            ProjectDocument: {
              type: 'object',
              properties: {
                projectId: {
                  type: 'string',
                  description: 'Project identifier',
                  example: '2h8kDmTxXBV7E6HdUzu9Pu3FQ7Qd'
                },
                document: {
                  type: 'object',
                  description: 'Complete automerge document',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                    lastModified: { type: 'string', format: 'date-time' },
                    nodes: { type: 'array', items: { type: 'object' } }
                  }
                },
                heads: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Automerge document heads for synchronization',
                  example: ['f4f03786c44cb06ef5a79ff0fb296e3e9f91517a8657a725ad334697fc191ad3']
                },
                lastModified: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true,
                  example: '2025-07-18T19:47:38.565Z'
                }
              }
            },
            CreateProjectRequest: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Project name (required)',
                  example: 'New Project'
                },
                description: {
                  type: 'string',
                  description: 'Optional project description',
                  example: 'A new collaborative project'
                }
              },
              required: ['name']
            },
            Error: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Error message',
                  example: 'Project not found'
                }
              }
            }
          }
        }
      },
      apis: ['./src/server.js'] // Path to the API files
    };

    const swaggerSpec = swaggerJsdoc(swaggerOptions);

    // Serve Swagger UI
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Automerge Sync Server API',
      swaggerOptions: {
        persistAuthorization: true,
        tryItOutEnabled: true,
        filter: true,
        requestInterceptor: (req) => {
          // Ensure proper CORS headers for Swagger UI requests
          req.headers['Access-Control-Allow-Origin'] = '*';
          return req;
        }
      }
    }));

    // Serve OpenAPI spec as JSON
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.send(swaggerSpec);
    });

    console.log(`API documentation available at: http://localhost:${PORT}/api-docs`);

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

    /**
     * @swagger
     * tags:
     *   - name: Projects
     *     description: Project management operations
     *   - name: System
     *     description: System information and health checks
     *   - name: WebSocket
     *     description: Real-time synchronization (WebSocket protocol)
     */

    /**
     * @swagger
     * /:
     *   get:
     *     summary: Health check
     *     description: Simple health check endpoint to verify the server is running
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Server is running
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: "👍 @automerge/automerge-repo-sync-server is running"
     */

    /**
     * @swagger
     * /ws:
     *   get:
     *     summary: WebSocket connection for real-time sync
     *     description: |
     *       Establish a WebSocket connection for real-time document synchronization.
     *       
     *       **Connection Details:**
     *       - Protocol: WebSocket
     *       - URL: `ws://localhost:3030` (development) or `wss://your-domain.com` (production)
     *       - Subprotocol: automerge-repo
     *       
     *       **Usage:**
     *       ```javascript
     *       const ws = new WebSocket('ws://localhost:3030');
     *       ws.onopen = () => console.log('Connected to sync server');
     *       ws.onmessage = (event) => console.log('Sync message:', event.data);
     *       ```
     *       
     *       **Features:**
     *       - Real-time document synchronization
     *       - Conflict-free collaborative editing
     *       - Automatic reconnection handling
     *       - Connection limits and heartbeat monitoring
     *     tags: [WebSocket]
     *     responses:
     *       101:
     *         description: WebSocket connection established
     *       429:
     *         description: Connection limit exceeded
     *       500:
     *         description: Server error
     */

    /**
     * @swagger
     * /api/projects:
     *   get:
     *     summary: List all projects
     *     description: Retrieve a list of all available automerge projects with metadata
     *     tags: [Projects]
     *     responses:
     *       200:
     *         description: List of projects retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 projects:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/Project'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
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

    /**
     * @swagger
     * /api/project/{projectId}:
     *   get:
     *     summary: Get a specific project
     *     description: Retrieve a complete automerge document for a specific project
     *     tags: [Projects]
     *     parameters:
     *       - in: path
     *         name: projectId
     *         required: true
     *         description: Unique project identifier
     *         schema:
     *           type: string
     *           example: "2h8kDmTxXBV7E6HdUzu9Pu3FQ7Qd"
     *     responses:
     *       200:
     *         description: Project retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ProjectDocument'
     *       404:
     *         description: Project not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
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

    /**
     * @swagger
     * /api/projects:
     *   post:
     *     summary: Create a new project
     *     description: Create a new automerge document with project metadata
     *     tags: [Projects]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/CreateProjectRequest'
     *           examples:
     *             basic:
     *               summary: Basic project
     *               value:
     *                 name: "My New Project"
     *                 description: "A collaborative project"
     *             minimal:
     *               summary: Minimal project
     *               value:
     *                 name: "Simple Project"
     *     responses:
     *       201:
     *         description: Project created successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ProjectDocument'
     *       400:
     *         description: Invalid request body
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *             examples:
     *               missing_name:
     *                 summary: Missing project name
     *                 value:
     *                   error: "Project name is required and must be a non-empty string"
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
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

    /**
     * @swagger
     * /api/project/{projectId}:
     *   delete:
     *     summary: Delete a project
     *     description: |
     *       Permanently delete an automerge project and all its associated data.
     *       
     *       **Warning:** This operation is irreversible and will remove:
     *       - The project document from storage
     *       - All document history and snapshots
     *       - Any active WebSocket connections for this document
     *       
     *       Use with caution in production environments.
     *     tags: [Projects]
     *     parameters:
     *       - in: path
     *         name: projectId
     *         required: true
     *         description: Unique project identifier to delete
     *         schema:
     *           type: string
     *           example: "2h8kDmTxXBV7E6HdUzu9Pu3FQ7Qd"
     *     responses:
     *       200:
     *         description: Project deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "Project deleted successfully"
     *                 projectId:
     *                   type: string
     *                   example: "2h8kDmTxXBV7E6HdUzu9Pu3FQ7Qd"
     *                 deletedAt:
     *                   type: string
     *                   format: date-time
     *                   example: "2025-07-19T10:30:00.000Z"
     *       404:
     *         description: Project not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *             example:
     *               error: "Project not found"
     *       500:
     *         description: Server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *             example:
     *               error: "Failed to delete project"
     */
    // API endpoint to delete a project
    app.delete("/api/project/:projectId", async (req, res) => {
      try {
        const { projectId } = req.params
        
        // First, check if the project exists
        const handle = this.#repo.find(projectId)
        await handle.whenReady()
        
        if (!handle.docSync()) {
          return res.status(404).json({ error: 'Project not found' })
        }
        
        // Get project info before deletion for logging
        const doc = handle.docSync()
        const projectName = doc.name || projectId
        
        // Delete from storage adapter
        const deleteResult = await this.deleteProjectFromStorage(this.#storageAdapter, projectId)
        
        if (!deleteResult.success) {
          console.error(`Failed to delete project ${projectId} from storage:`, deleteResult.error)
          return res.status(500).json({ error: 'Failed to delete project from storage' })
        }
        
        // Remove from repo cache
        this.#repo.delete(projectId)
        
        console.log(`Deleted project: ${projectId} (${projectName})`)
        
        res.json({
          message: 'Project deleted successfully',
          projectId,
          deletedAt: new Date().toISOString()
        })
      } catch (error) {
        console.error('Error deleting project:', error)
        if (error.message && error.message.includes('not found')) {
          res.status(404).json({ error: 'Project not found' })
        } else {
          res.status(500).json({ error: 'Failed to delete project' })
        }
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
   * Delete a project from the storage adapter
   * @param {*} storageAdapter 
   * @param {string} projectId 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteProjectFromStorage(storageAdapter, projectId) {
    try {
      if (storageAdapter instanceof R2StorageAdapter) {
        // For R2 storage, delete all objects with the project prefix
        return await storageAdapter.deleteDocument(projectId)
      } else if (storageAdapter instanceof NodeFSStorageAdapter) {
        // For filesystem storage, remove the project directory
        return await this.deleteFromFilesystem(storageAdapter, projectId)
      } else {
        console.warn('Unknown storage adapter type, cannot delete project')
        return { success: false, error: 'Unsupported storage adapter' }
      }
    } catch (error) {
      console.error('Error deleting project from storage:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Delete a project from filesystem storage
   * @param {NodeFSStorageAdapter} storageAdapter 
   * @param {string} projectId 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteFromFilesystem(storageAdapter, projectId) {
    try {
      const dir = storageAdapter.path || '.amrg'
      
      // Find and remove the project directory
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = `${dir}/${entry.name}`
          const projectPath = `${subDir}/${projectId}`
          
          if (fs.existsSync(projectPath)) {
            // Remove the entire project directory
            fs.rmSync(projectPath, { recursive: true, force: true })
            console.log(`Deleted project directory: ${projectPath}`)
            return { success: true }
          }
        }
      }
      
      // Project not found in filesystem
      return { success: false, error: 'Project not found in filesystem' }
    } catch (error) {
      console.error('Error deleting from filesystem:', error)
      return { success: false, error: error.message }
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
