/**
 * Request Logging Middleware for Automerge Sync Server
 * 
 * Provides comprehensive request tracking including:
 * - HTTP request/response logging
 * - Performance metrics
 * - Error tracking
 * - User activity tracking
 * - Security monitoring
 */

import fs from 'fs'
import path from 'path'

export class RequestLogger {
  constructor(options = {}) {
    this.options = {
      logToFile: options.logToFile ?? true,
      logToConsole: options.logToConsole ?? true,
      logDirectory: options.logDirectory || './logs',
      logLevel: options.logLevel || 'info', // 'debug', 'info', 'warn', 'error'
      includeBody: options.includeBody ?? false,
      includeHeaders: options.includeHeaders ?? false,
      maxBodyLength: options.maxBodyLength || 1000,
      excludePaths: options.excludePaths || ['/health', '/favicon.ico'],
      sensitiveHeaders: options.sensitiveHeaders || ['authorization', 'cookie', 'x-api-key'],
      ...options
    }

    this.setupLogDirectory()
  }

  /**
   * Setup log directory if file logging is enabled
   */
  setupLogDirectory() {
    if (this.options.logToFile) {
      try {
        if (!fs.existsSync(this.options.logDirectory)) {
          fs.mkdirSync(this.options.logDirectory, { recursive: true })
        }
      } catch (error) {
        console.error('Failed to create log directory:', error)
        this.options.logToFile = false
      }
    }
  }

  /**
   * Get middleware function for Express
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now()
      const requestId = this.generateRequestId()
      
      // Add request ID to request object for use in other middleware
      req.requestId = requestId

      // Skip logging for excluded paths
      if (this.options.excludePaths.includes(req.path)) {
        return next()
      }

      // Store reference to this for use in callbacks
      const logger = this

      // Capture original res.end to log response
      const originalEnd = res.end
      const originalWrite = res.write
      let responseBody = ''

      // Override res.write to capture response body if needed
      if (this.options.includeBody) {
        res.write = function(chunk, encoding) {
          if (chunk) {
            responseBody += chunk.toString()
          }
          return originalWrite.call(this, chunk, encoding)
        }
      }

      // Override res.end to log when response is complete
      res.end = function(chunk, encoding) {
        if (chunk) {
          responseBody += chunk.toString()
        }

        const endTime = Date.now()
        const responseTime = endTime - startTime

        // Restore original methods before logging
        res.end = originalEnd
        res.write = originalWrite

        // Log the request asynchronously to avoid blocking
        setImmediate(() => {
          try {
            const logData = logger.createLogEntry(req, res, {
              requestId,
              startTime,
              endTime,
              responseTime,
              responseBody: logger.options.includeBody ? logger.truncateBody(responseBody) : undefined
            })

            logger.writeLog(logData)
          } catch (error) {
            console.error('Error writing request log:', error)
          }
        })

        return originalEnd.call(this, chunk, encoding)
      }

      next()
    }
  }

  /**
   * Create log entry object
   */
  createLogEntry(req, res, metadata) {
    const userAgent = req.get('User-Agent')
    const forwardedFor = req.get('X-Forwarded-For')
    const realIp = req.get('X-Real-IP')
    
    // Extract user info if available (from JWT token)
    let userId = null
    let username = null
    if (req.user) {
      userId = req.user.id || req.user.sub
      username = req.user.username || req.user.name
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: metadata.requestId,
      
      // Request details
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      
      // Client details
      ip: realIp || forwardedFor || req.ip || req.connection.remoteAddress,
      userAgent,
      
      // User details
      userId,
      username,
      
      // Response details
      statusCode: res.statusCode,
      responseTime: metadata.responseTime,
      contentLength: res.get('Content-Length'),
      
      // Timing
      startTime: metadata.startTime,
      endTime: metadata.endTime,
      
      // Optional details
      headers: this.options.includeHeaders ? this.sanitizeHeaders(req.headers) : undefined,
      body: this.options.includeBody ? this.truncateBody(this.getRequestBody(req)) : undefined,
      responseBody: metadata.responseBody,
      
      // Categorization
      logLevel: this.determineLogLevel(res.statusCode),
      category: this.categorizeRequest(req),
      
      // Additional metadata
      referer: req.get('Referer'),
      protocol: req.protocol,
      secure: req.secure,
      httpVersion: req.httpVersion
    }

    return logEntry
  }

  /**
   * Get request body safely
   */
  getRequestBody(req) {
    try {
      if (req.body && typeof req.body === 'object') {
        return JSON.stringify(req.body)
      }
      return req.body?.toString() || ''
    } catch (error) {
      return '[Unable to parse body]'
    }
  }

  /**
   * Sanitize headers by removing sensitive information
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers }
    
    for (const header of this.options.sensitiveHeaders) {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]'
      }
    }
    
    return sanitized
  }

  /**
   * Truncate body content if too long
   */
  truncateBody(body) {
    if (!body) return body
    
    const bodyStr = body.toString()
    if (bodyStr.length > this.options.maxBodyLength) {
      return bodyStr.substring(0, this.options.maxBodyLength) + '... [TRUNCATED]'
    }
    
    return bodyStr
  }

  /**
   * Determine log level based on status code
   */
  determineLogLevel(statusCode) {
    if (statusCode >= 500) return 'error'
    if (statusCode >= 400) return 'warn'
    if (statusCode >= 300) return 'info'
    return 'info'
  }

  /**
   * Categorize request type
   */
  categorizeRequest(req) {
    const path = req.path.toLowerCase()
    
    if (path.startsWith('/auth')) return 'authentication'
    if (path.startsWith('/api/projects')) return 'project_management'
    if (path.startsWith('/api/graph')) return 'graph_analysis'
    if (path.startsWith('/api/users')) return 'user_management'
    if (path.startsWith('/api-docs')) return 'documentation'
    if (path.includes('websocket') || path.includes('ws')) return 'websocket'
    if (req.method === 'GET' && (path === '/' || path === '/health')) return 'health_check'
    
    return 'general'
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Write log entry to file and/or console
   */
  writeLog(logData) {
    const shouldLog = this.shouldLog(logData.logLevel)
    if (!shouldLog) return

    // Console logging
    if (this.options.logToConsole) {
      this.logToConsole(logData)
    }

    // File logging
    if (this.options.logToFile) {
      this.logToFile(logData)
    }
  }

  /**
   * Check if should log based on log level
   */
  shouldLog(level) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    const currentLevel = levels[this.options.logLevel] || 1
    const messageLevel = levels[level] || 1
    
    return messageLevel >= currentLevel
  }

  /**
   * Log to console with formatting
   */
  logToConsole(logData) {
    const statusColor = this.getStatusColor(logData.statusCode)
    const methodColor = this.getMethodColor(logData.method)
    
    console.log(
      `${statusColor}${logData.statusCode}\x1b[0m ${methodColor}${logData.method}\x1b[0m ` +
      `${logData.path} - ${logData.responseTime}ms - ${logData.ip} ` +
      `${logData.username ? `[${logData.username}]` : ''}`
    )

    // Log errors with more detail
    if (logData.statusCode >= 400) {
      console.log(`  Request ID: ${logData.requestId}`)
      if (logData.body && this.options.includeBody) {
        console.log(`  Body: ${logData.body}`)
      }
    }
  }

  /**
   * Get color code for status code
   */
  getStatusColor(statusCode) {
    if (statusCode >= 500) return '\x1b[31m' // Red
    if (statusCode >= 400) return '\x1b[33m' // Yellow
    if (statusCode >= 300) return '\x1b[36m' // Cyan
    return '\x1b[32m' // Green
  }

  /**
   * Get color code for HTTP method
   */
  getMethodColor(method) {
    const colors = {
      GET: '\x1b[32m',    // Green
      POST: '\x1b[33m',   // Yellow
      PUT: '\x1b[34m',    // Blue
      DELETE: '\x1b[31m', // Red
      PATCH: '\x1b[35m'   // Magenta
    }
    return colors[method] || '\x1b[37m' // White
  }

  /**
   * Log to file
   */
  logToFile(logData) {
    try {
      const date = new Date().toISOString().split('T')[0]
      const logFile = path.join(this.options.logDirectory, `requests-${date}.log`)
      
      const logLine = JSON.stringify(logData) + '\n'
      
      fs.appendFileSync(logFile, logLine)
      
      // Also log errors to separate error log
      if (logData.statusCode >= 400) {
        const errorLogFile = path.join(this.options.logDirectory, `errors-${date}.log`)
        fs.appendFileSync(errorLogFile, logLine)
      }
      
    } catch (error) {
      console.error('Failed to write to log file:', error)
    }
  }

  /**
   * Get request statistics for a date range
   */
  async getRequestStats(startDate, endDate) {
    // This would be implemented to read and analyze log files
    // For now, returning a placeholder
    return {
      totalRequests: 0,
      avgResponseTime: 0,
      statusCodeBreakdown: {},
      topEndpoints: [],
      topUsers: [],
      errorRate: 0
    }
  }
}

/**
 * Create default request logger instance
 */
export function createRequestLogger(options = {}) {
  return new RequestLogger(options)
}

/**
 * Security-focused request logger for monitoring suspicious activity
 */
export function createSecurityLogger() {
  return new RequestLogger({
    logLevel: 'info',
    includeHeaders: true,
    includeBody: true,
    logDirectory: './logs/security',
    excludePaths: ['/health'], // Only exclude health checks
    maxBodyLength: 2000 // Longer for security analysis
  })
}
