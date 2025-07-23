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
import { 
  authenticateToken, 
  requirePermission, 
  generateAccessToken, 
  generateRefreshToken, 
  verifyToken, 
  extractToken,
  authenticateWebSocket
} from "./auth/jwt.js"
import { 
  initializeUsers, 
  authenticateUser, 
  createUser, 
  getAllUsers, 
  updatePassword, 
  deleteUser, 
  getUser 
} from "./auth/users.js"
import { getUserService } from "./auth/DatabaseUserService.js"

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

  constructor() {
    var hostname = os.hostname()

    // Initialize user system (database-first, fallback to file-based)
    console.log('Initializing JWT authentication system...')
    this.initializeAuthSystem()
    console.log('✅ Authentication system ready')

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
        activeConnections--
        return
      }

      // WebSocket authentication (if required)
      if (process.env.REQUIRE_WS_AUTH === 'true') {
        const url = new URL(request.url, `http://${request.headers.host}`)
        const token = url.searchParams.get('token') || 
                     request.headers.authorization?.replace('Bearer ', '')
        
        const user = authenticateWebSocket(token)
        if (!user) {
          console.warn('WebSocket authentication failed - closing connection')
          ws.close(1008, 'Authentication required')
          activeConnections--
          return
        }
        
        console.log(`WebSocket authenticated for user: ${user.username}`)
        ws.user = user
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
    app.use(express.json()) // Add JSON parsing middleware

    console.log(process.env.NODE_ENV);

    // Swagger/OpenAPI configuration
    const swaggerOptions = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'Automerge Repo Sync Server API',
          version: '1.0.0',
          description: 'A collaborative document sync server using Automerge CRDT with JWT authentication, PostgreSQL database support, REST API for project management and WebSocket for real-time synchronization.',
          contact: {
            name: 'API Support',
            url: 'https://github.com/toku-group/automerge-repo-sync-server',
          },
        },
        servers: [
          {
            url: `http://localhost:${PORT}`,
            description: 'Development server',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        },
        security: [
          {
            bearerAuth: [],
          },
        ],
      },
      apis: ['./src/server.js'], // Path to the API docs
    };

    const specs = swaggerJsdoc(swaggerOptions);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(specs);
    });

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

    /**
     * @swagger
     * /:
     *   get:
     *     summary: Health check endpoint
     *     description: Returns a simple message confirming the server is running
     *     responses:
     *       200:
     *         description: Server is running
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: "👍 @automerge/automerge-repo-sync-server is running"
     */
    app.get("/", (req, res) => {
      res.send(`👍 @automerge/automerge-repo-sync-server is running`)
    })

    /**
     * @swagger
     * /ws-info:
     *   get:
     *     summary: WebSocket connection information
     *     description: Get information about WebSocket connectivity and authentication requirements
     *     responses:
     *       200:
     *         description: WebSocket connection information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 websocketUrl:
     *                   type: string
     *                   description: WebSocket connection URL
     *                   example: "ws://localhost:3030"
     *                 authenticationRequired:
     *                   type: boolean
     *                   description: Whether WebSocket authentication is required
     *                 connectionMethod:
     *                   type: string
     *                   description: How to provide authentication
     *                   example: "Query parameter: ?token=YOUR_JWT_TOKEN or Authorization header"
     *                 activeConnections:
     *                   type: number
     *                   description: Current number of active WebSocket connections
     *                 maxConnections:
     *                   type: number
     *                   description: Maximum allowed WebSocket connections
     */
    app.get("/ws-info", (req, res) => {
      const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
      const wsProtocol = protocol === 'https' ? 'wss' : 'ws'
      const host = req.headers.host
      
      res.json({
        websocketUrl: `${wsProtocol}://${host}`,
        authenticationRequired: process.env.REQUIRE_WS_AUTH === 'true',
        connectionMethod: process.env.REQUIRE_WS_AUTH === 'true' 
          ? "Query parameter: ?token=YOUR_JWT_TOKEN or Authorization header: Bearer YOUR_JWT_TOKEN"
          : "No authentication required",
        activeConnections: this.#socket.clients.size,
        maxConnections: parseInt(process.env.MAX_CONNECTIONS) || 100,
        automergeSync: "This WebSocket endpoint supports Automerge document synchronization using @automerge/automerge-repo-network-websocket protocol"
      })
    })

    /**
     * @swagger
     * /api/projects:
     *   get:
     *     summary: List all projects
     *     description: Retrieve a list of all available projects
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: List of projects
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                     description: Project ID
     *                   name:
     *                     type: string
     *                     description: Project name
     *                   created:
     *                     type: string
     *                     format: date-time
     *                     description: Creation timestamp
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *       403:
     *         description: Forbidden - Insufficient permissions
     */
    app.get("/api/projects", authenticateToken, requirePermission('read'), (req, res) => {
      // For now, return an empty array - this would connect to actual project storage
      res.json([])
    })

    /**
     * @swagger
     * /api/projects:
     *   post:
     *     summary: Create a new project
     *     description: Create a new project with the specified name
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *             properties:
     *               name:
     *                 type: string
     *                 description: Project name
     *                 example: "My Project"
     *               description:
     *                 type: string
     *                 description: Project description
     *                 example: "A collaborative document project"
     *     responses:
     *       201:
     *         description: Project created successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 id:
     *                   type: string
     *                   description: Generated project ID
     *                 name:
     *                   type: string
     *                   description: Project name
     *                 description:
     *                   type: string
     *                   description: Project description
     *                 created:
     *                   type: string
     *                   format: date-time
     *                   description: Creation timestamp
     *       400:
     *         description: Bad request - Missing or invalid data
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *       403:
     *         description: Forbidden - Insufficient permissions
     */
    app.post("/api/projects", authenticateToken, requirePermission('write'), (req, res) => {
      const { name, description } = req.body
      
      if (!name) {
        return res.status(400).json({ error: 'Project name is required' })
      }
      
      // For now, return a mock response - this would connect to actual project storage
      const project = {
        id: `project_${Date.now()}`,
        name,
        description,
        created: new Date().toISOString()
      }
      
      res.status(201).json(project)
    })

    /**
     * @swagger
     * /auth/login:
     *   post:
     *     summary: User login
     *     description: Authenticate a user with username and password
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - username
     *               - password
     *             properties:
     *               username:
     *                 type: string
     *                 description: Username
     *                 example: "admin"
     *               password:
     *                 type: string
     *                 description: Password
     *                 example: "admin123"
     *     responses:
     *       200:
     *         description: Login successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "Login successful"
     *                 accessToken:
     *                   type: string
     *                   description: JWT access token
     *                 refreshToken:
     *                   type: string
     *                   description: JWT refresh token
     *                 user:
     *                   type: object
     *                   properties:
     *                     username:
     *                       type: string
     *                     permissions:
     *                       type: array
     *                       items:
     *                         type: string
     *       401:
     *         description: Invalid credentials
     *       500:
     *         description: Internal server error
     */
    app.post("/auth/login", async (req, res) => {
      try {
        const { username, password } = req.body

        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password are required' })
        }

        // Initialize auth system if not already done
        if (!this.userService) {
          await this.initializeAuthSystem()
        }

        let user
        if (this.useDatabase && this.userService) {
          // Use database authentication
          user = await this.userService.authenticateUser(username, password)
        } else {
          // Use file-based authentication
          user = authenticateUser(username, password)
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' })
        }

        const accessToken = generateAccessToken(user)
        const refreshToken = generateRefreshToken(user)

        // Store refresh token if using database
        if (this.useDatabase && this.userService) {
          // Generate token expiry date
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + 7) // 7 days from now
          
          // Hash the refresh token before storing
          const crypto = await import('crypto')
          const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
          
          await this.userService.storeRefreshToken(user.id, tokenHash, expiresAt)
        }

        res.json({
          message: 'Login successful',
          accessToken,
          refreshToken,
          user: {
            username: user.username,
            permissions: user.permissions
          }
        })
      } catch (error) {
        console.error('Login error:', error)
        res.status(500).json({ error: 'Internal server error' })
      }
    })

    /**
     * @swagger
     * /auth/me:
     *   get:
     *     summary: Get current user information
     *     description: Get information about the currently authenticated user
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: User information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 username:
     *                   type: string
     *                   description: Username
     *                 permissions:
     *                   type: array
     *                   items:
     *                     type: string
     *                   description: User permissions
     *                 profile:
     *                   type: object
     *                   description: User profile information
     *       401:
     *         description: Unauthorized - Invalid or missing token
     */
    app.get("/auth/me", authenticateToken, (req, res) => {
      res.json({
        username: req.user.username,
        permissions: req.user.permissions,
        profile: req.user.profile || {}
      })
    })

    /**
     * @swagger
     * /auth/refresh:
     *   post:
     *     summary: Refresh access token
     *     description: Exchange a refresh token for a new access token
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - refreshToken
     *             properties:
     *               refreshToken:
     *                 type: string
     *                 description: Valid refresh token
     *     responses:
     *       200:
     *         description: New access token generated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 accessToken:
     *                   type: string
     *                   description: New JWT access token
     *       401:
     *         description: Invalid or expired refresh token
     *       500:
     *         description: Internal server error
     */
    app.post("/auth/refresh", async (req, res) => {
      try {
        const { refreshToken } = req.body

        if (!refreshToken) {
          return res.status(401).json({ error: 'Refresh token required' })
        }

        // Verify the refresh token
        const decoded = verifyToken(refreshToken)
        if (!decoded || decoded.type !== 'refresh') {
          return res.status(401).json({ error: 'Invalid refresh token' })
        }

        // Initialize auth system if not already done
        if (!this.userService) {
          await this.initializeAuthSystem()
        }

        let user
        if (this.useDatabase && this.userService) {
          // Hash the refresh token for database lookup
          const crypto = await import('crypto')
          const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
          
          // Verify refresh token exists in database and is not revoked
          const tokenData = await this.userService.verifyRefreshToken(tokenHash)
          if (!tokenData) {
            return res.status(401).json({ error: 'Invalid or revoked refresh token' })
          }
          user = await this.userService.getUser(tokenData.username)
        } else {
          // File-based fallback - just verify the user exists
          user = getUser(decoded.username)
        }

        if (!user) {
          return res.status(401).json({ error: 'User not found' })
        }

        // Generate new access token
        const accessToken = generateAccessToken(user)

        res.json({ accessToken })
      } catch (error) {
        console.error('Refresh token error:', error)
        res.status(401).json({ error: 'Invalid refresh token' })
      }
    })

    /**
     * @swagger
     * /auth/change-password:
     *   post:
     *     summary: Change user password
     *     description: Change the password for the currently authenticated user
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - currentPassword
     *               - newPassword
     *             properties:
     *               currentPassword:
     *                 type: string
     *                 description: Current password
     *               newPassword:
     *                 type: string
     *                 description: New password
     *     responses:
     *       200:
     *         description: Password changed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "Password changed successfully"
     *       400:
     *         description: Bad request - Missing required fields
     *       401:
     *         description: Unauthorized - Invalid current password
     *       500:
     *         description: Internal server error
     */
    app.post("/auth/change-password", authenticateToken, async (req, res) => {
      try {
        const { currentPassword, newPassword } = req.body

        if (!currentPassword || !newPassword) {
          return res.status(400).json({ error: 'Current password and new password are required' })
        }

        // Initialize auth system if not already done
        if (!this.userService) {
          await this.initializeAuthSystem()
        }

        if (this.useDatabase && this.userService) {
          // Verify current password and update - use 'sub' field from JWT token which contains user ID
          const success = await this.userService.changePassword(req.user.sub, currentPassword, newPassword)
          if (!success) {
            return res.status(401).json({ error: 'Invalid current password' })
          }
        } else {
          // File-based fallback
          const success = updatePassword(req.user.username, currentPassword, newPassword)
          if (!success) {
            return res.status(401).json({ error: 'Invalid current password' })
          }
        }

        res.json({ message: 'Password changed successfully' })
      } catch (error) {
        console.error('Change password error:', error)
        res.status(500).json({ error: 'Internal server error' })
      }
    })

    /**
     * @swagger
     * /api/project/{projectId}:
     *   get:
     *     summary: Get specific project
     *     description: Retrieve details of a specific project by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: projectId
     *         required: true
     *         schema:
     *           type: string
     *         description: Project ID
     *     responses:
     *       200:
     *         description: Project details
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 id:
     *                   type: string
     *                   description: Project ID
     *                 name:
     *                   type: string
     *                   description: Project name
     *                 description:
     *                   type: string
     *                   description: Project description
     *                 created:
     *                   type: string
     *                   format: date-time
     *                   description: Creation timestamp
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *       403:
     *         description: Forbidden - Insufficient permissions
     *       404:
     *         description: Project not found
     */
    app.get("/api/project/:projectId", authenticateToken, requirePermission('read'), (req, res) => {
      const { projectId } = req.params
      
      // For now, return a mock response - this would connect to actual project storage
      const project = {
        id: projectId,
        name: `Project ${projectId}`,
        description: `Description for project ${projectId}`,
        created: new Date().toISOString()
      }
      
      res.json(project)
    })

    /**
     * @swagger
     * /api/project/{projectId}:
     *   delete:
     *     summary: Delete specific project
     *     description: Delete a specific project by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: projectId
     *         required: true
     *         schema:
     *           type: string
     *         description: Project ID
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
     *                 id:
     *                   type: string
     *                   description: Deleted project ID
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *       403:
     *         description: Forbidden - Insufficient permissions
     *       404:
     *         description: Project not found
     */
    app.delete("/api/project/:projectId", authenticateToken, requirePermission('delete'), (req, res) => {
      const { projectId } = req.params
      
      // For now, return a success response - this would connect to actual project storage
      res.json({
        message: 'Project deleted successfully',
        id: projectId
      })
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
   * Initialize authentication system with database-first approach
   */
  async initializeAuthSystem() {
    try {
      // Try to initialize database service first
      const dbUserService = getUserService()
      const dbInitialized = await dbUserService.initialize()
      
      if (dbInitialized) {
        console.log('✅ Database authentication service initialized')
        this.userService = dbUserService
        this.useDatabase = true
        
        // Create default admin user if no users exist
        try {
          const users = await dbUserService.listUsers(1, 0)
          if (users.length === 0) {
            console.log('📝 Creating default admin user...')
            await dbUserService.createUser({
              username: 'admin',
              password: 'admin123',
              permissions: ['admin', 'read', 'write', 'delete'],
              profile: { role: 'administrator', created_by: 'system' }
            })
            console.log('✅ Default admin user created (username: admin, password: admin123)')
            console.log('⚠️  Please change the default password immediately!')
          }
        } catch (error) {
          console.log('ℹ️  Admin user already exists or creation failed:', error.message)
        }
      } else {
        throw new Error('Database not available')
      }
    } catch (error) {
      console.log('⚠️  Database authentication failed, falling back to file-based storage')
      console.log('   Reason:', error.message)
      
      // Fallback to file-based authentication
      initializeUsers()
      this.useDatabase = false
      console.log('✅ File-based authentication system ready')
    }
  }
}
