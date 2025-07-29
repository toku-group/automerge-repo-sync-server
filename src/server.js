import 'dotenv/config'
// console.log(process.env) // Commented out to prevent terminal overflow

// @ts-check
import fs from "fs"
import express from "express"
import cors from "cors"
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
import { getProjectService } from "./database/ProjectService.js"
import { getNeo4jService } from "./database/Neo4jService.js"
import { GraphAnalysisController } from "./controllers/GraphAnalysisController.js"
import { createRequestLogger } from "./middleware/RequestLogger.js"

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

  /** @type {import("@automerge/automerge-repo").StorageAdapterInterface} */
  #storageAdapter

  /** @type {import("./database/ProjectService.js").ProjectService} */
  #projectService

  /** @type {import("./database/Neo4jService.js").Neo4jService} */
  #neo4jService

  constructor() {
    console.log('🚀 Server constructor starting...')
    var hostname = os.hostname()

    // Initialize user system (database-first, fallback to file-based)
    console.log('Initializing JWT authentication system...')
    this.initializeAuthSystem().then(() => {
      console.log('✅ Authentication system ready')
    }).catch(error => {
      console.log('⚠️  Authentication system initialization failed:', error.message)
    })

    // Initialize project service
    console.log('Initializing project management system...')
    this.initializeProjectService().then(() => {
      console.log('✅ Project management system ready')
    }).catch(error => {
      console.log('⚠️  Project service initialization failed:', error.message)
    })

    // Initialize Neo4j graph database service
    console.log('Initializing Neo4j graph database service...')
    this.initializeNeo4jService().then(() => {
      console.log('✅ Neo4j service initialized')
    }).catch(error => {
      console.log('⚠️  Neo4j service initialization failed:', error.message)
    })

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

    // Configure CORS
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
      : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3030']
    
    const corsOptions = {
      origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true)
        
        // Check if the origin is allowed
        const isAllowed = allowedOrigins.some(allowedOrigin => {
          // Support wildcard subdomains
          if (allowedOrigin.includes('*')) {
            const pattern = allowedOrigin.replace(/\*/g, '.*')
            const regex = new RegExp(`^${pattern}$`)
            return regex.test(origin)
          }
          return allowedOrigin === origin
        })
        
        if (isAllowed) {
          callback(null, true)
        } else {
          console.warn(`CORS blocked request from origin: ${origin}`)
          callback(new Error('Not allowed by CORS'))
        }
      },
      credentials: true, // Allow cookies and authorization headers
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['Content-Length', 'X-Total-Count'],
      maxAge: 86400 // Cache preflight response for 24 hours
    }

    app.use(cors(corsOptions))
    app.use(express.static("public"))
    app.use(express.json()) // Add JSON parsing middleware

    // Extract user info from JWT for logging (non-blocking)
    app.use((req, res, next) => {
      try {
        const token = extractToken(req)
        if (token) {
          const decoded = verifyToken(token)
          req.user = decoded // Add user info for logging
        }
      } catch (error) {
        // Ignore JWT errors here - let auth middleware handle them
      }
      next()
    })

    // Request logging middleware
    const requestLogger = createRequestLogger({
      logToFile: true,
      logToConsole: process.env.NODE_ENV === 'development',
      logLevel: process.env.LOG_LEVEL || 'info',
      includeBody: process.env.LOG_INCLUDE_BODY === 'true',
      includeHeaders: process.env.LOG_INCLUDE_HEADERS === 'true',
      excludePaths: ['/health', '/favicon.ico', '/api-docs.json'],
      logDirectory: process.env.LOG_DIRECTORY || './logs'
    })
    app.use(requestLogger.middleware())

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
          license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT',
          },
        },
        servers: [
          {
            url: `http://localhost:${PORT}`,
            description: 'Development server',
          },
        ],
        tags: [
          {
            name: 'System',
            description: 'System health and information endpoints',
          },
          {
            name: 'WebSocket',
            description: 'WebSocket connection and real-time synchronization',
          },
          {
            name: 'Authentication',
            description: 'User authentication and authorization endpoints',
          },
          {
            name: 'User Management',
            description: 'User administration and management endpoints (admin only)',
          },
          {
            name: 'Projects',
            description: 'Project and document management endpoints',
          },
          {
            name: 'Graph Analysis',
            description: 'Neo4j graph database analysis and querying endpoints',
          },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'JWT Bearer token authentication. Use the login form above to authenticate and get a token, or manually enter your JWT token here.',
            },
          },
          schemas: {
            LoginRequest: {
              type: 'object',
              required: ['username', 'password'],
              properties: {
                username: {
                  type: 'string',
                  description: 'Username',
                  example: 'admin',
                },
                password: {
                  type: 'string',
                  description: 'Password',
                  example: 'admin123',
                },
              },
            },
            LoginResponse: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  example: 'Login successful',
                },
                accessToken: {
                  type: 'string',
                  description: 'JWT access token for API authentication',
                },
                refreshToken: {
                  type: 'string',
                  description: 'JWT refresh token for obtaining new access tokens',
                },
                user: {
                  type: 'object',
                  properties: {
                    username: {
                      type: 'string',
                    },
                    permissions: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
            Error: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Error message',
                },
                code: {
                  type: 'string',
                  description: 'Error code (for authentication errors)',
                },
                details: {
                  type: 'string',
                  description: 'Additional error details (only in development mode)',
                },
              },
              required: ['error'],
            },
            DatabaseError: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Database error message',
                  example: 'Failed to retrieve projects',
                },
                details: {
                  type: 'string',
                  description: 'Technical error details (development mode only)',
                  example: 'invalid input syntax for type uuid: "invalid-uuid-format"',
                },
              },
              required: ['error'],
            },
            ValidationError: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Validation error message',
                  example: 'Project name is required',
                },
              },
              required: ['error'],
            },
            ConflictError: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Conflict error message',
                  example: 'A project with this name already exists',
                },
              },
              required: ['error'],
            },
            AuthenticationError: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Authentication error message',
                  example: 'Access token required',
                },
                code: {
                  type: 'string',
                  description: 'Authentication error code',
                  enum: ['MISSING_TOKEN', 'INVALID_TOKEN', 'EXPIRED_TOKEN'],
                  example: 'MISSING_TOKEN',
                },
              },
              required: ['error'],
            },
            User: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'User ID',
                },
                username: {
                  type: 'string',
                  description: 'Username',
                },
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'Email address',
                },
                permissions: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'User permissions',
                },
                is_active: {
                  type: 'boolean',
                  description: 'Whether the user is active',
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'User creation timestamp',
                },
                last_login: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Last login timestamp',
                },
              },
            },
            Project: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Project/Document ID',
                },
                name: {
                  type: 'string',
                  description: 'Project name',
                },
                title: {
                  type: 'string',
                  description: 'Document title (if available)',
                },
                description: {
                  type: 'string',
                  description: 'Project description',
                },
                created: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Creation timestamp',
                },
                lastModified: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Last modification timestamp',
                },
                documentType: {
                  type: 'string',
                  description: 'Type of document',
                },
                status: {
                  type: 'string',
                  description: 'Document status',
                },
              },
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
    
    // Custom Swagger UI setup with login functionality
    const swaggerUiOptions = {
      customCss: `
        .swagger-ui .topbar { display: none; }
        #swagger-login-form {
          background: #fafafa;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 20px;
          margin: 20px 0;
          max-width: 400px;
        }
        #swagger-login-form h3 {
          margin-top: 0;
          color: #3b4151;
        }
        #swagger-login-form input {
          width: 100%;
          padding: 8px 12px;
          margin: 8px 0;
          border: 1px solid #ccc;
          border-radius: 4px;
          box-sizing: border-box;
        }
        #swagger-login-form button {
          background-color: #4CAF50;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-right: 10px;
        }
        #swagger-login-form button:hover {
          background-color: #45a049;
        }
        #swagger-login-form .logout-btn {
          background-color: #f44336;
        }
        #swagger-login-form .logout-btn:hover {
          background-color: #da190b;
        }
        #login-status {
          margin: 10px 0;
          padding: 8px;
          border-radius: 4px;
        }
        .status-success {
          background-color: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .status-error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .status-info {
          background-color: #d1ecf1;
          color: #0c5460;
          border: 1px solid #bee5eb;
        }
      `,
      customJs: `
        window.onload = function() {
          // Wait for Swagger UI to load
          setTimeout(function() {
            const ui = window.ui;
            
            // Add login form to the page
            const loginForm = document.createElement('div');
            loginForm.id = 'swagger-login-form';
            loginForm.innerHTML = \`
              <h3>🔐 API Authentication</h3>
              <div id="login-status"></div>
              <div id="login-fields">
                <input type="text" id="username" placeholder="Username (default: admin)" />
                <input type="password" id="password" placeholder="Password (default: admin123)" />
                <button onclick="swaggerLogin()">Login</button>
              </div>
              <div id="logout-section" style="display: none;">
                <p><strong>Logged in as:</strong> <span id="current-user"></span></p>
                <button class="logout-btn" onclick="swaggerLogout()">Logout</button>
              </div>
            \`;
            
            // Insert the login form at the top of the Swagger UI
            const swaggerContainer = document.querySelector('.swagger-ui');
            if (swaggerContainer) {
              swaggerContainer.insertBefore(loginForm, swaggerContainer.firstChild);
            }
            
            // Check if user is already logged in
            const token = localStorage.getItem('swagger-jwt-token');
            if (token) {
              validateAndSetToken(token);
            }
            
            // Global login function
            window.swaggerLogin = function() {
              const username = document.getElementById('username').value || 'admin';
              const password = document.getElementById('password').value || 'admin123';
              
              showStatus('Logging in...', 'info');
              
              fetch('/auth/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
              })
              .then(response => {
                if (!response.ok) {
                  throw new Error(\`Login failed: \${response.status}\`);
                }
                return response.json();
              })
              .then(data => {
                if (data.accessToken) {
                  localStorage.setItem('swagger-jwt-token', data.accessToken);
                  localStorage.setItem('swagger-user', data.user.username);
                  setAuthToken(data.accessToken, data.user.username);
                  showStatus(\`Successfully logged in as \${data.user.username}\`, 'success');
                } else {
                  throw new Error('No access token received');
                }
              })
              .catch(error => {
                console.error('Login error:', error);
                showStatus(\`Login failed: \${error.message}\`, 'error');
              });
            };
            
            // Global logout function
            window.swaggerLogout = function() {
              localStorage.removeItem('swagger-jwt-token');
              localStorage.removeItem('swagger-user');
              ui.authActions.logout(['bearerAuth']);
              document.getElementById('login-fields').style.display = 'block';
              document.getElementById('logout-section').style.display = 'none';
              showStatus('Logged out successfully', 'info');
            };
            
            // Function to validate and set token
            function validateAndSetToken(token) {
              const username = localStorage.getItem('swagger-user') || 'Unknown';
              
              // Validate token by calling /auth/me
              fetch('/auth/me', {
                headers: {
                  'Authorization': \`Bearer \${token}\`
                }
              })
              .then(response => {
                if (response.ok) {
                  return response.json();
                } else {
                  throw new Error('Token invalid');
                }
              })
              .then(data => {
                setAuthToken(token, data.username);
                showStatus(\`Restored session for \${data.username}\`, 'success');
              })
              .catch(() => {
                localStorage.removeItem('swagger-jwt-token');
                localStorage.removeItem('swagger-user');
                showStatus('Previous session expired', 'error');
              });
            }
            
            // Function to set auth token in Swagger UI
            function setAuthToken(token, username) {
              ui.authActions.authorize({
                bearerAuth: {
                  name: 'bearerAuth',
                  schema: {
                    type: 'http',
                    scheme: 'bearer'
                  },
                  value: token
                }
              });
              
              document.getElementById('login-fields').style.display = 'none';
              document.getElementById('logout-section').style.display = 'block';
              document.getElementById('current-user').textContent = username;
            }
            
            // Function to show status messages
            function showStatus(message, type) {
              const statusDiv = document.getElementById('login-status');
              statusDiv.textContent = message;
              statusDiv.className = \`status-\${type}\`;
              statusDiv.style.display = 'block';
              
              if (type === 'success' || type === 'info') {
                setTimeout(() => {
                  statusDiv.style.display = 'none';
                }, 3000);
              }
            }
            
            // Add Enter key support for login form
            document.addEventListener('keypress', function(e) {
              if (e.key === 'Enter' && (e.target.id === 'username' || e.target.id === 'password')) {
                swaggerLogin();
              }
            });
            
          }, 1000);
        };
      `,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true
      }
    };
    
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, swaggerUiOptions));
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

    // Store reference to storage adapter for API access
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

    // Set up Neo4j document watching if enabled
    this.setupNeo4jDocumentWatching()

    /**
     * @swagger
     * /:
     *   get:
     *     tags: [System]
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
     * /health:
     *   get:
     *     tags: [System]
     *     summary: Health check endpoint
     *     description: Returns server health status including database connections and system information
     *     responses:
     *       200:
     *         description: Server is healthy
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 status:
     *                   type: string
     *                   example: "healthy"
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     *                 uptime:
     *                   type: number
     *                   description: Server uptime in seconds
     *                 memory:
     *                   type: object
     *                   properties:
     *                     used:
     *                       type: number
     *                     total:
     *                       type: number
     *                 connections:
     *                   type: object
     *                   properties:
     *                     websocket:
     *                       type: number
     *                     database:
     *                       type: string
     */
    app.get("/health", async (req, res) => {
      try {
        const memUsage = process.memoryUsage()
        const healthData = {
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: {
            used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            total: Math.round(memUsage.heapTotal / 1024 / 1024) // MB
          },
          connections: {
            websocket: this.#socket.clients.size,
            database: this.#projectService ? "connected" : "disconnected",
            neo4j: this.#neo4jService ? "connected" : "disconnected"
          },
          version: process.env.npm_package_version || "unknown"
        }
        
        res.json(healthData)
      } catch (error) {
        console.error('Health check error:', error)
        res.status(500).json({
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          error: "Health check failed"
        })
      }
    })

    /**
     * @swagger
     * /ws-info:
     *   get:
     *     tags: [WebSocket]
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
     *     tags: [Projects]
     *     summary: List all projects
     *     description: Retrieve a list of all available projects from Automerge document storage
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
     *                 $ref: '#/components/schemas/Project'
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       403:
     *         description: Forbidden - Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error - Database connection issues or other server errors
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Database connection unavailable or schema not initialized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     */
    app.get("/api/projects", authenticateToken, requirePermission('read'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          // Fallback to old method if project service not available
          const projects = await this.listAutomergeDocuments()
          return res.json(projects)
        }

        const userId = req.user.sub // User ID from JWT token
        const limit = parseInt(req.query.limit) || 50
        const offset = parseInt(req.query.offset) || 0

        const projects = await this.#projectService.getUserProjects(userId, { limit, offset })
        res.json(projects)
      } catch (error) {
        console.error('Error listing projects:', error)
        
        // Handle specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          return res.status(503).json({ error: 'Database connection unavailable' })
        }
        
        if (error.code === '42P01') { // relation does not exist
          return res.status(503).json({ error: 'Database schema not properly initialized' })
        }
        
        res.status(500).json({ 
          error: 'Failed to retrieve projects',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      }
    })

    /**
     * @swagger
     * /api/projects:
     *   post:
     *     tags: [Projects]
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
     *               $ref: '#/components/schemas/Project'
     *       400:
     *         description: Bad request - Missing or invalid data (e.g., missing project name, invalid user reference)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       403:
     *         description: Forbidden - Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       409:
     *         description: Conflict - Project name already exists
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ConflictError'
     *       500:
     *         description: Internal server error - Database connection issues or other server errors
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Database connection unavailable or schema not initialized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     */
    app.post("/api/projects", authenticateToken, requirePermission('write'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          return res.status(503).json({ error: 'Project management service not available' })
        }

        const { name, description, settings = {}, metadata = {} } = req.body
        const userId = req.user.sub // User ID from JWT token
        
        if (!name) {
          return res.status(400).json({ error: 'Project name is required' })
        }
        
        const project = await this.#projectService.createProject({
          name,
          description,
          ownerId: userId,
          settings,
          metadata
        })
        
        res.status(201).json(project)
      } catch (error) {
        console.error('Error creating project:', error)
        
        // Handle specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          return res.status(503).json({ error: 'Database connection unavailable' })
        }
        
        if (error.code === '23505') { // Unique constraint violation
          return res.status(409).json({ error: 'A project with this name already exists' })
        }
        
        if (error.code === '23503') { // Foreign key constraint violation
          return res.status(400).json({ error: 'Invalid user ID or reference data' })
        }
        
        if (error.code === '42P01') { // relation does not exist
          return res.status(503).json({ error: 'Database schema not properly initialized' })
        }
        
        if (error.message.includes('already exists')) {
          return res.status(409).json({ error: error.message })
        }
        
        res.status(500).json({ 
          error: 'Failed to create project',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      }
    })

    /**
     * @swagger
     * /auth/login:
     *   post:
     *     tags: [Authentication]
     *     summary: User login
     *     description: 'Authenticate a user with username and password. Default credentials: admin/admin123. Use the login form above for quick authentication.'
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/LoginRequest'
     *     responses:
     *       200:
     *         description: Login successful
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/LoginResponse'
     *       400:
     *         description: Bad request - Missing username or password
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
     *       401:
     *         description: Invalid credentials
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       500:
     *         description: Internal server error - Database connection issues
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Authentication service not available
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
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
     *     tags: [Authentication]
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
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
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
     *     tags: [Authentication]
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
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
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
     *     tags: [Authentication]
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
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Unauthorized - Invalid current password
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
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
     * /auth/users:
     *   get:
     *     tags: [User Management]
     *     summary: List all users
     *     description: Get a list of all users in the system. Requires admin permissions.
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           minimum: 1
     *           maximum: 100
     *           default: 50
     *         description: Maximum number of users to return
     *       - in: query
     *         name: offset
     *         schema:
     *           type: integer
     *           minimum: 0
     *           default: 0
     *         description: Number of users to skip for pagination
     *     responses:
     *       200:
     *         description: List of users
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 users:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/User'
     *                 pagination:
     *                   type: object
     *                   properties:
     *                     limit:
     *                       type: integer
     *                     offset:
     *                       type: integer
     *                     total:
     *                       type: integer
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Forbidden - Insufficient permissions (admin required)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    app.get("/auth/users", authenticateToken, requirePermission('admin'), async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50
        const offset = parseInt(req.query.offset) || 0

        // Validate parameters
        if (limit < 1 || limit > 100) {
          return res.status(400).json({ error: 'Limit must be between 1 and 100' })
        }
        if (offset < 0) {
          return res.status(400).json({ error: 'Offset must be non-negative' })
        }

        // Initialize auth system if not already done
        if (!this.userService) {
          await this.initializeAuthSystem()
        }

        if (this.useDatabase && this.userService) {
          // Use database user service
          const users = await this.userService.listUsers(limit, offset)
          
          // Get total count for pagination
          const countResult = await this.userService.db.query('SELECT COUNT(*) FROM users')
          const total = parseInt(countResult.rows[0].count)

          res.json({
            users: users.map(user => ({
              id: user.id,
              username: user.username,
              email: user.email,
              permissions: user.permissions,
              is_active: user.is_active,
              created_at: user.created_at,
              last_login: user.last_login
            })),
            pagination: {
              limit,
              offset,
              total
            }
          })
        } else {
          // File-based fallback
          const users = getAllUsers()
          const usersArray = Object.entries(users).map(([username, userData]) => ({
            id: username, // In file-based mode, username is the ID
            username,
            email: userData.email || null,
            permissions: userData.permissions || [],
            is_active: true, // File-based mode doesn't have deactivation
            created_at: userData.created_at || null,
            last_login: userData.last_login || null
          }))

          const startIndex = offset
          const endIndex = offset + limit
          const paginatedUsers = usersArray.slice(startIndex, endIndex)

          res.json({
            users: paginatedUsers,
            pagination: {
              limit,
              offset,
              total: usersArray.length
            }
          })
        }
      } catch (error) {
        console.error('List users error:', error)
        res.status(500).json({ error: 'Internal server error' })
      }
    })

    /**
     * @swagger
     * /auth/users/{userId}:
     *   delete:
     *     tags: [User Management]
     *     summary: Delete a user
     *     description: Permanently delete a user from the system. This action is irreversible and will delete all user data including tokens, sessions, and audit logs. Requires admin permissions.
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: userId
     *         required: true
     *         schema:
     *           type: string
     *         description: User ID to delete
     *     responses:
     *       200:
     *         description: User deleted successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: "User deleted successfully"
     *                 userId:
     *                   type: string
     *                   description: ID of the deleted user
     *       400:
     *         description: Bad request - Invalid user ID or cannot delete own account
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       403:
     *         description: Forbidden - Insufficient permissions (admin required)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: User not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     */
    app.delete("/auth/users/:userId", authenticateToken, requirePermission('admin'), async (req, res) => {
      try {
        const { userId } = req.params

        if (!userId) {
          return res.status(400).json({ error: 'User ID is required' })
        }

        // Prevent users from deleting their own account
        if (req.user.sub === userId) {
          return res.status(400).json({ error: 'Cannot delete your own account' })
        }

        // Initialize auth system if not already done
        if (!this.userService) {
          await this.initializeAuthSystem()
        }

        if (this.useDatabase && this.userService) {
          // Use database user service
          const success = await this.userService.deleteUser(userId)
          if (!success) {
            return res.status(404).json({ error: 'User not found' })
          }
        } else {
          // File-based fallback - not implemented for security reasons
          return res.status(501).json({ error: 'User deletion not supported in file-based mode' })
        }

        res.json({ 
          message: 'User deleted successfully',
          userId: userId
        })
      } catch (error) {
        console.error('Delete user error:', error)
        if (error.message === 'User not found') {
          res.status(404).json({ error: 'User not found' })
        } else {
          res.status(500).json({ error: 'Internal server error' })
        }
      }
    })

    /**
     * @swagger
     * /api/project/{projectId}:
     *   get:
     *     tags: [Projects]
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
     *               $ref: '#/components/schemas/Project'
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       403:
     *         description: Forbidden - Insufficient permissions
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Project not found or access denied
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error - Invalid UUID format or database connection issues
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Database connection unavailable or schema not initialized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     */
    app.get("/api/project/:projectId", authenticateToken, requirePermission('read'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          return res.status(503).json({ error: 'Project management service not available' })
        }

        const { projectId } = req.params
        const userId = req.user.sub // User ID from JWT token
        
        const project = await this.#projectService.getProject(projectId, userId)
        
        if (!project) {
          return res.status(404).json({ error: 'Project not found or access denied' })
        }
        
        res.json(project)
      } catch (error) {
        console.error('Error getting project:', error)
        
        // Handle specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          return res.status(503).json({ error: 'Database connection unavailable' })
        }
        
        if (error.code === '42P01') { // relation does not exist
          return res.status(503).json({ error: 'Database schema not properly initialized' })
        }
        
        if (error.message.includes('not found') || error.message.includes('access denied')) {
          return res.status(404).json({ error: error.message })
        }
        
        res.status(500).json({ 
          error: 'Failed to retrieve project',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      }
    })

    /**
     * @swagger
     * /api/project/{projectId}:
     *   delete:
     *     tags: [Projects]
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
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       403:
     *         description: Forbidden - Insufficient permissions or not project owner
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Project not found or access denied
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error - Invalid UUID format or database connection issues
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Database connection unavailable or schema not initialized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     */
    app.delete("/api/project/:projectId", authenticateToken, requirePermission('delete'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          return res.status(503).json({ error: 'Project management service not available' })
        }

        const { projectId } = req.params
        const userId = req.user.sub // User ID from JWT token
        
        const deleted = await this.#projectService.deleteProject(projectId, userId)
        
        if (!deleted) {
          return res.status(404).json({ error: 'Project not found or access denied' })
        }
        
        res.json({
          message: 'Project deleted successfully',
          id: projectId
        })
      } catch (error) {
        console.error('Error deleting project:', error)
        
        // Handle specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          return res.status(503).json({ error: 'Database connection unavailable' })
        }
        
        if (error.code === '42P01') { // relation does not exist
          return res.status(503).json({ error: 'Database schema not properly initialized' })
        }
        
        if (error.message.includes('not found') || error.message.includes('access denied')) {
          return res.status(404).json({ error: error.message })
        }
        
        if (error.message.includes('owner')) {
          return res.status(403).json({ error: error.message })
        }
        
        res.status(500).json({ 
          error: 'Failed to delete project',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      }
    })

    /**
     * @swagger
     * /api/project/{projectId}/documents:
     *   get:
     *     tags: [Projects]
     *     summary: Get project documents
     *     description: Retrieve all documents for a specific project
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
     *         description: List of project documents
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   documentId:
     *                     type: string
     *                   name:
     *                     type: string
     *                   description:
     *                     type: string
     *                   documentType:
     *                     type: string
     *                   createdAt:
     *                     type: string
     *                     format: date-time
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       403:
     *         description: Forbidden - Insufficient permissions to view documents
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       404:
     *         description: Project not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error - Invalid UUID format or database connection issues
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Database connection unavailable or schema not initialized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     */
    app.get("/api/project/:projectId/documents", authenticateToken, requirePermission('read'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          return res.status(503).json({ error: 'Project management service not available' })
        }

        const { projectId } = req.params
        const userId = req.user.sub

        const documents = await this.#projectService.getProjectDocuments(projectId, userId)
        res.json(documents)
      } catch (error) {
        console.error('Error getting project documents:', error)
        
        // Handle specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          return res.status(503).json({ error: 'Database connection unavailable' })
        }
        
        if (error.code === '42P01') { // relation does not exist
          return res.status(503).json({ error: 'Database schema not properly initialized' })
        }
        
        if (error.message.includes('permission')) {
          return res.status(403).json({ error: error.message })
        }
        
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message })
        }
        
        res.status(500).json({ 
          error: 'Failed to retrieve project documents',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      }
    })

    /**
     * @swagger
     * /api/project/{projectId}/documents:
     *   post:
     *     tags: [Projects]
     *     summary: Add document to project
     *     description: Add an Automerge document to a project
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: projectId
     *         required: true
     *         schema:
     *           type: string
     *         description: Project ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - documentId
     *               - name
     *             properties:
     *               documentId:
     *                 type: string
     *                 description: Automerge document ID
     *               name:
     *                 type: string
     *                 description: Document name
     *               description:
     *                 type: string
     *                 description: Document description
     *               documentType:
     *                 type: string
     *                 description: Document type
     *                 default: automerge-document
     *               metadata:
     *                 type: object
     *                 description: Document metadata
     *     responses:
     *       201:
     *         description: Document added successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 id:
     *                   type: string
     *                 documentId:
     *                   type: string
     *                 name:
     *                   type: string
     *                 projectId:
     *                   type: string
     *       400:
     *         description: Bad request - Missing required fields
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationError'
     *       401:
     *         description: Unauthorized - Invalid or missing token
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AuthenticationError'
     *       403:
     *         description: Forbidden - Insufficient permissions to add documents
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       409:
     *         description: Conflict - Document ID already exists or name already used
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ConflictError'
     *       500:
     *         description: Internal server error - Database connection issues
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     *       503:
     *         description: Service unavailable - Database connection unavailable or schema not initialized
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/DatabaseError'
     */
    app.post("/api/project/:projectId/documents", authenticateToken, requirePermission('write'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          return res.status(503).json({ error: 'Project management service not available' })
        }

        const { projectId } = req.params
        const { documentId, name, description, documentType, metadata = {} } = req.body
        const userId = req.user.sub

        if (!documentId || !name) {
          return res.status(400).json({ error: 'documentId and name are required' })
        }

        const document = await this.#projectService.addDocument({
          projectId,
          documentId,
          name,
          description,
          documentType,
          metadata,
          userId
        })

        res.status(201).json(document)
      } catch (error) {
        console.error('Error adding document to project:', error)
        
        // Handle specific database errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          return res.status(503).json({ error: 'Database connection unavailable' })
        }
        
        if (error.code === '23505') { // Unique constraint violation
          return res.status(409).json({ error: 'Document already exists in this project' })
        }
        
        if (error.code === '23503') { // Foreign key constraint violation
          return res.status(400).json({ error: 'Invalid project ID or document reference' })
        }
        
        if (error.code === '42P01') { // relation does not exist
          return res.status(503).json({ error: 'Database schema not properly initialized' })
        }
        
        if (error.message.includes('permission')) {
          return res.status(403).json({ error: error.message })
        }
        
        if (error.message.includes('already exists')) {
          return res.status(409).json({ error: error.message })
        }
        
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message })
        }
        
        res.status(500).json({ 
          error: 'Failed to add document to project',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        })
      }
    })

    /**
     * @swagger
     * /api/documents/{documentId}:
     *   delete:
     *     tags: [Projects]
     *     summary: Remove document from project
     *     description: Remove a document from its project
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: documentId
     *         required: true
     *         schema:
     *           type: string
     *         description: Document ID (database ID, not Automerge document ID)
     *     responses:
     *       200:
     *         description: Document removed successfully
     *       401:
     *         $ref: '#/components/schemas/Error'
     *       403:
     *         $ref: '#/components/schemas/Error'
     *       404:
     *         $ref: '#/components/schemas/Error'
     */
    app.delete("/api/documents/:documentId", authenticateToken, requirePermission('write'), async (req, res) => {
      try {
        if (!this.useProjectService) {
          return res.status(503).json({ error: 'Project management service not available' })
        }

        const { documentId } = req.params
        const userId = req.user.sub

        const removed = await this.#projectService.removeDocument(documentId, userId)

        if (!removed) {
          return res.status(404).json({ error: 'Document not found or access denied' })
        }

        res.json({ message: 'Document removed successfully' })
      } catch (error) {
        console.error('Error removing document:', error)
        
        if (error.message.includes('permission')) {
          return res.status(403).json({ error: error.message })
        }
        
        if (error.message.includes('not found')) {
          return res.status(404).json({ error: error.message })
        }
        
        res.status(500).json({ error: 'Failed to remove document' })
      }
    })

    // ==================== GRAPH ANALYSIS API ROUTES ====================

    /**
     * @swagger
     * /api/graph/stats:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Get graph database statistics
     *     description: Retrieve overall statistics about the graph database
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Graph statistics retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     documentCount:
     *                       type: integer
     *                     totalNodes:
     *                       type: integer
     *                     totalRelationships:
     *                       type: integer
     *                     allNodeTypes:
     *                       type: array
     *                       items:
     *                         type: string
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/stats", authenticateToken, requirePermission('read'), GraphAnalysisController.getStatistics)

    /**
     * @swagger
     * /api/graph/document/{documentId}/analysis:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Get document analysis from graph
     *     description: Retrieve graph analysis for a specific document
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: documentId
     *         required: true
     *         schema:
     *           type: string
     *         description: Document ID
     *     responses:
     *       200:
     *         description: Document analysis retrieved successfully
     *       404:
     *         description: Document not found in graph database
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/document/:documentId/analysis", authenticateToken, requirePermission('read'), GraphAnalysisController.getDocumentAnalysis)

    /**
     * @swagger
     * /api/graph/document/{documentId}/similar:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Find similar documents
     *     description: Find documents with similar structure to the given document
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: documentId
     *         required: true
     *         schema:
     *           type: string
     *         description: Document ID
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *           maximum: 50
     *         description: Maximum number of results
     *     responses:
     *       200:
     *         description: Similar documents found successfully
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/document/:documentId/similar", authenticateToken, requirePermission('read'), GraphAnalysisController.findSimilarDocuments)

    /**
     * @swagger
     * /api/graph/document/{documentId}/structure:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Get document graph structure
     *     description: Retrieve the graph structure of a document for visualization
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: documentId
     *         required: true
     *         schema:
     *           type: string
     *         description: Document ID
     *       - in: query
     *         name: depth
     *         schema:
     *           type: integer
     *           default: 2
     *           maximum: 5
     *         description: Maximum traversal depth
     *     responses:
     *       200:
     *         description: Document graph structure retrieved successfully
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/document/:documentId/structure", authenticateToken, requirePermission('read'), GraphAnalysisController.getDocumentGraph)

    /**
     * @swagger
     * /api/graph/nodes/types:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Get node types distribution
     *     description: Get distribution of node types across documents
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: projectId
     *         schema:
     *           type: string
     *         description: Filter by project ID
     *     responses:
     *       200:
     *         description: Node types distribution retrieved successfully
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/nodes/types", authenticateToken, requirePermission('read'), GraphAnalysisController.getNodeTypesDistribution)

    /**
     * @swagger
     * /api/graph/nodes/search:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Search nodes by content
     *     description: Search for nodes containing specific content
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: searchTerm
     *         required: true
     *         schema:
     *           type: string
     *         description: Search term
     *       - in: query
     *         name: nodeType
     *         schema:
     *           type: string
     *         description: Filter by node type
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *           maximum: 200
     *         description: Maximum number of results
     *     responses:
     *       200:
     *         description: Node search completed successfully
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/nodes/search", authenticateToken, requirePermission('read'), GraphAnalysisController.searchNodes)

    /**
     * @swagger
     * /api/graph/relationships/patterns:
     *   get:
     *     tags: [Graph Analysis]
     *     summary: Get relationship patterns
     *     description: Analyze relationship patterns in the graph
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: documentId
     *         schema:
     *           type: string
     *         description: Filter by document ID
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 20
     *           maximum: 100
     *         description: Maximum number of results
     *     responses:
     *       200:
     *         description: Relationship patterns retrieved successfully
     *       503:
     *         description: Graph database service not available
     */
    app.get("/api/graph/relationships/patterns", authenticateToken, requirePermission('read'), GraphAnalysisController.getRelationshipPatterns)

    /**
     * @swagger
     * /api/graph/query:
     *   post:
     *     tags: [Graph Analysis]
     *     summary: Execute custom Cypher query (admin only)
     *     description: Execute a custom Cypher query against the graph database (read-only)
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - query
     *             properties:
     *               query:
     *                 type: string
     *                 description: Cypher query (read-only operations only)
     *               parameters:
     *                 type: object
     *                 description: Query parameters
     *     responses:
     *       200:
     *         description: Query executed successfully
     *       403:
     *         description: Write operations are forbidden
     *       503:
     *         description: Graph database service not available
     */
    app.post("/api/graph/query", authenticateToken, requirePermission('admin'), GraphAnalysisController.executeQuery)

    this.#server = app.listen(PORT, '0.0.0.0', () => {
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

  /**
   * List all available Automerge documents from storage
   * @returns {Promise<Array>} Array of project objects
   */
  async listAutomergeDocuments() {
    try {
      const projects = []
      
      // Use the stored storage adapter reference
      if (!this.#storageAdapter) {
        console.warn('No storage adapter available')
        return []
      }

      // For filesystem storage, we need to scan directories to find document IDs
      // For R2 storage, we use loadRange with empty prefix to list all documents
      let documentIds = new Set()

      if (process.env.USE_R2_STORAGE === "true") {
        // R2 storage: use loadRange to scan all objects
        try {
          console.log('Scanning R2 storage for documents...')
          const chunks = await this.#storageAdapter.loadRange([])
          console.log(`Found ${chunks.length} chunks in R2 storage`)
          
          // Extract unique document IDs from the chunk keys
          for (const chunk of chunks) {
            if (chunk.key && chunk.key.length > 0) {
              // Document ID is typically the first part of the key
              const documentId = chunk.key[0]
              if (documentId && documentId.length > 10) { // Basic validation for document ID format
                documentIds.add(documentId)
                console.log(`Found document ID: ${documentId}`)
              }
            }
          }
        } catch (error) {
          console.error('Error scanning R2 storage:', error)
        }
      } else {
        // Filesystem storage: scan the data directory
        const dataDir = process.env.DATA_DIR || ".amrg"
        try {
          if (fs.existsSync(dataDir)) {
            const entries = fs.readdirSync(dataDir, { withFileTypes: true })
            
            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.length >= 2) {
                // This is a potential document ID prefix directory
                const prefixDir = `${dataDir}/${entry.name}`
                const subEntries = fs.readdirSync(prefixDir, { withFileTypes: true })
                
                for (const subEntry of subEntries) {
                  if (subEntry.isDirectory()) {
                    // The subdirectory name should be the rest of the document ID
                    const documentId = entry.name + subEntry.name
                    if (documentId.length > 10) { // Basic validation
                      documentIds.add(documentId)
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('Error scanning filesystem storage:', error)
        }
      }

      console.log(`Found ${documentIds.size} unique document IDs`)

      // For each document ID, try to load the document and extract metadata
      for (const documentId of documentIds) {
        try {
          // Try to get the document from the repo
          const handle = this.#repo.find(documentId)
          
          // Wait a bit for the document to load
          await Promise.race([
            handle.whenReady(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
          ])
          
          const doc = handle.docSync()
          
          if (doc) {
            // Extract project information from the document
            const project = {
              id: documentId,
              name: doc.title || doc.name || doc.projectName || `Document ${documentId.substring(0, 8)}`,
              title: doc.title || undefined,
              description: doc.description || undefined,
              content: doc.content ? (typeof doc.content === 'string' ? doc.content.substring(0, 100) : 'Document has content') : undefined,
              created: doc.timestamp || doc.createdAt || doc.created || undefined,
              documentType: doc.type || 'automerge-document',
              lastModified: doc.lastModified || doc.updatedAt || undefined,
              version: doc.version || undefined,
              items: Array.isArray(doc.items) ? doc.items.length : undefined
            }
            
            projects.push(project)
            console.log(`Successfully loaded document: ${project.name}`)
          }
        } catch (error) {
          // If we can't load the document, still include basic info
          console.log(`Could not load full document ${documentId}:`, error.message)
          projects.push({
            id: documentId,
            name: `Document ${documentId.substring(0, 8)}`,
            documentType: 'automerge-document',
            status: 'metadata-unavailable'
          })
        }
      }

      // Sort projects by name or creation date
      projects.sort((a, b) => {
        if (a.created && b.created) {
          return new Date(b.created).getTime() - new Date(a.created).getTime()
        }
        return a.name.localeCompare(b.name)
      })

      console.log(`Returning ${projects.length} projects`)
      return projects
      
    } catch (error) {
      console.error('Error listing Automerge documents:', error)
      return []
    }
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

  /**
   * Initialize project management system
   */
  async initializeProjectService() {
    try {
      this.#projectService = getProjectService()
      const initialized = await this.#projectService.initialize()
      
      if (initialized) {
        console.log('✅ Database project service initialized')
        this.useProjectService = true
      } else {
        throw new Error('Database not available')
      }
    } catch (error) {
      console.log('⚠️  Database project service failed to initialize')
      console.log('   Reason:', error.message)
      console.log('   Project management will be disabled')
      this.useProjectService = false
    }
  }

  /**
   * Initialize Neo4j graph database service
   */
  async initializeNeo4jService() {
    try {
      this.#neo4jService = getNeo4jService()
      const initialized = await this.#neo4jService.initialize()
      
      if (initialized) {
        console.log('✅ Neo4j graph database service initialized')
        this.useNeo4j = true
      } else {
        console.log('ℹ️  Neo4j service not configured - graph analysis will be disabled')
        this.useNeo4j = false
      }
    } catch (error) {
      console.log('⚠️  Neo4j service failed to initialize')
      console.log('   Reason:', error.message)
      console.log('   Graph analysis will be disabled')
      this.useNeo4j = false
    }
  }

  /**
   * Set up Neo4j document watching for Automerge documents
   */
  setupNeo4jDocumentWatching() {
    if (!this.useNeo4j || !this.#neo4jService) {
      console.log('📊 Neo4j document watching skipped (service not available)')
      return
    }

    console.log('📊 Setting up Neo4j document watching...')

    // Watch for new documents being created or loaded
    this.#repo.on('document', async (documentId) => {
      try {
        console.log(`📊 New document detected: ${documentId}`)
        const handle = this.#repo.find(documentId)
        
        // Get project ID if available
        let projectId = null
        if (this.useProjectService) {
          try {
            // Try to find the project that contains this document
            const projects = await this.#projectService.getAllProjects()
            for (const project of projects) {
              const docs = await this.#projectService.getProjectDocuments(project.id)
              if (docs.some(doc => doc.documentId === documentId)) {
                projectId = project.id
                break
              }
            }
          } catch (error) {
            console.log(`Could not determine project for document ${documentId}:`, error.message)
          }
        }

        // Start watching this document
        await this.#neo4jService.watchDocument(documentId, handle, projectId)
        
      } catch (error) {
        console.error(`Error setting up Neo4j watching for document ${documentId}:`, error)
      }
    })

    // Also watch existing documents if any
    setTimeout(async () => {
      try {
        console.log('📊 Scanning for existing documents to watch...')
        const documents = await this.listAutomergeDocuments()
        
        for (const doc of documents) {
          try {
            const handle = this.#repo.find(doc.id)
            await this.#neo4jService.watchDocument(doc.id, handle, doc.projectId)
          } catch (error) {
            console.error(`Error watching existing document ${doc.id}:`, error)
          }
        }
        
        console.log(`📊 Started watching ${documents.length} existing documents`)
        
      } catch (error) {
        console.error('Error scanning existing documents for Neo4j watching:', error)
      }
    }, 5000) // Wait 5 seconds for the repo to be fully initialized
  }

  /**
   * Manually trigger Neo4j sync for a document (useful for API endpoints)
   * @param {string} documentId - Document ID to sync
   * @returns {Promise<boolean>} Success status
   */
  async syncDocumentToNeo4j(documentId) {
    if (!this.useNeo4j || !this.#neo4jService) {
      return false
    }

    try {
      const handle = this.#repo.find(documentId)
      
      // Get project ID if available
      let projectId = null
      if (this.useProjectService) {
        try {
          const projects = await this.#projectService.getAllProjects()
          for (const project of projects) {
            const docs = await this.#projectService.getProjectDocuments(project.id)
            if (docs.some(doc => doc.documentId === documentId)) {
              projectId = project.id
              break
            }
          }
        } catch (error) {
          console.log(`Could not determine project for document ${documentId}:`, error.message)
        }
      }

      await this.#neo4jService.syncDocumentToGraph(documentId, handle, projectId)
      return true
      
    } catch (error) {
      console.error(`Error manually syncing document ${documentId} to Neo4j:`, error)
      return false
    }
  }
}
