// @ts-check
import { getDatabaseService } from '../database/DatabaseService.js'

/**
 * Service for managing projects and their associated Automerge documents
 */
export class ProjectService {
  /** @type {import('../database/DatabaseService.js').DatabaseService} */
  #db

  constructor() {
    this.#db = getDatabaseService()
  }

  /**
   * Initialize the project service
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      const initialized = await this.#db.initialize()
      if (!initialized) {
        throw new Error('Database service failed to initialize')
      }
      return true
    } catch (error) {
      console.error('Failed to initialize ProjectService:', error)
      return false
    }
  }

  /**
   * Create a new project
   * @param {Object} params
   * @param {string} params.name - Project name
   * @param {string} [params.description] - Project description
   * @param {string} params.ownerId - User ID of the project owner
   * @param {Object} [params.settings] - Project settings
   * @param {Object} [params.metadata] - Project metadata
   * @returns {Promise<Object>}
   */
  async createProject({ name, description, ownerId, settings = {}, metadata = {} }) {
    try {
      const result = await this.#db.query(
        `INSERT INTO projects (name, description, owner_id, settings, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name, description, ownerId, JSON.stringify(settings), JSON.stringify(metadata)]
      )

      const project = result.rows[0]

      // Log project creation
      await this.logActivity({
        projectId: project.id,
        userId: ownerId,
        action: 'project_created',
        details: { name, description }
      })

      return this.formatProject(project)
    } catch (error) {
      if (error.code === '23505') { // Unique constraint violation
        throw new Error('A project with this name already exists')
      }
      throw error
    }
  }

  /**
   * Get projects for a user
   * @param {string} userId - User ID
   * @param {Object} [options] - Query options
   * @param {number} [options.limit] - Limit results
   * @param {number} [options.offset] - Offset for pagination
   * @returns {Promise<Array>}
   */
  async getUserProjects(userId, { limit = 50, offset = 0 } = {}) {
    try {
      const result = await this.#db.query(
        `SELECT * FROM get_user_projects($1) LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      )

      return result.rows.map(row => ({
        id: row.project_id,
        name: row.project_name,
        description: row.description,
        role: row.role,
        documentCount: parseInt(row.document_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    } catch (error) {
      console.error('Error getting user projects:', error)
      throw error
    }
  }

  /**
   * Get a project by ID
   * @param {string} projectId - Project ID
   * @param {string} [userId] - User ID for permission checking
   * @returns {Promise<Object|null>}
   */
  async getProject(projectId, userId = null) {
    try {
      let query = `
        SELECT p.*, u.username as owner_username,
               COUNT(pd.id) as document_count
        FROM projects p
        JOIN users u ON p.owner_id = u.id
        LEFT JOIN project_documents pd ON p.id = pd.project_id
        WHERE p.id = $1 AND p.is_active = true
      `
      let params = [projectId]

      // If userId provided, check permissions
      if (userId) {
        query += `
          AND (p.owner_id = $2 OR EXISTS (
            SELECT 1 FROM project_collaborators pc 
            WHERE pc.project_id = p.id AND pc.user_id = $2
          ))
        `
        params.push(userId)
      }

      query += ` GROUP BY p.id, u.username`

      const result = await this.#db.query(query, params)

      if (result.rows.length === 0) {
        return null
      }

      const project = result.rows[0]
      return this.formatProject(project, { includeDocumentCount: true })
    } catch (error) {
      console.error('Error getting project:', error)
      throw error
    }
  }

  /**
   * Update a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID making the update
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>}
   */
  async updateProject(projectId, userId, updates) {
    try {
      // Check if user has permission to update
      const hasPermission = await this.checkProjectPermission(projectId, userId, 'write')
      if (!hasPermission) {
        throw new Error('Insufficient permissions to update project')
      }

      const allowedFields = ['name', 'description', 'settings', 'metadata']
      const updateFields = []
      const params = []
      let paramIndex = 1

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = $${paramIndex}`)
          params.push(key === 'settings' || key === 'metadata' ? JSON.stringify(value) : value)
          paramIndex++
        }
      }

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update')
      }

      params.push(projectId)

      const result = await this.#db.query(
        `UPDATE projects 
         SET ${updateFields.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex} AND is_active = true
         RETURNING *`,
        params
      )

      if (result.rows.length === 0) {
        throw new Error('Project not found')
      }

      const project = result.rows[0]

      // Log project update
      await this.logActivity({
        projectId: project.id,
        userId,
        action: 'project_updated',
        details: updates
      })

      return this.formatProject(project)
    } catch (error) {
      console.error('Error updating project:', error)
      throw error
    }
  }

  /**
   * Delete a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID making the deletion
   * @returns {Promise<boolean>}
   */
  async deleteProject(projectId, userId) {
    try {
      // Check if user is the owner
      const project = await this.getProject(projectId, userId)
      if (!project) {
        throw new Error('Project not found')
      }

      // Only the owner can delete a project
      const ownerCheck = await this.#db.query(
        'SELECT owner_id FROM projects WHERE id = $1',
        [projectId]
      )

      if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].owner_id !== userId) {
        throw new Error('Only project owner can delete the project')
      }

      // Soft delete the project
      await this.#db.query(
        'UPDATE projects SET is_active = false, updated_at = NOW() WHERE id = $1',
        [projectId]
      )

      // Log project deletion
      await this.logActivity({
        projectId,
        userId,
        action: 'project_deleted',
        details: { projectName: project.name }
      })

      return true
    } catch (error) {
      console.error('Error deleting project:', error)
      throw error
    }
  }

  /**
   * Add a document to a project
   * @param {Object} params
   * @param {string} params.projectId - Project ID
   * @param {string} params.documentId - Automerge document ID
   * @param {string} params.name - Document name
   * @param {string} [params.description] - Document description
   * @param {string} [params.documentType] - Document type
   * @param {string} [params.r2Prefix] - R2 storage prefix
   * @param {Object} [params.metadata] - Document metadata
   * @param {string} params.userId - User ID adding the document
   * @returns {Promise<Object>}
   */
  async addDocument({ projectId, documentId, name, description, documentType = 'automerge-document', r2Prefix, metadata = {}, userId }) {
    try {
      // Check project permissions
      const hasPermission = await this.checkProjectPermission(projectId, userId, 'write')
      if (!hasPermission) {
        throw new Error('Insufficient permissions to add documents')
      }

      const result = await this.#db.query(
        `INSERT INTO project_documents (project_id, document_id, name, description, document_type, r2_prefix, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [projectId, documentId, name, description, documentType, r2Prefix, JSON.stringify(metadata)]
      )

      const document = result.rows[0]

      // Log document addition
      await this.logActivity({
        projectId,
        userId,
        documentId: document.id,
        action: 'document_added',
        details: { documentId, name, documentType }
      })

      return this.formatDocument(document)
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('Document ID already exists or document name already used in this project')
      }
      throw error
    }
  }

  /**
   * Get documents for a project
   * @param {string} projectId - Project ID
   * @param {string} [userId] - User ID for permission checking
   * @returns {Promise<Array>}
   */
  async getProjectDocuments(projectId, userId = null) {
    try {
      if (userId) {
        const hasPermission = await this.checkProjectPermission(projectId, userId, 'read')
        if (!hasPermission) {
          throw new Error('Insufficient permissions to view documents')
        }
      }

      const result = await this.#db.query(
        `SELECT * FROM project_documents 
         WHERE project_id = $1 
         ORDER BY created_at DESC`,
        [projectId]
      )

      return result.rows.map(this.formatDocument)
    } catch (error) {
      console.error('Error getting project documents:', error)
      throw error
    }
  }

  /**
   * Remove a document from a project
   * @param {string} documentId - Document ID
   * @param {string} userId - User ID making the removal
   * @returns {Promise<boolean>}
   */
  async removeDocument(documentId, userId) {
    try {
      // Get document and check permissions
      const docResult = await this.#db.query(
        'SELECT * FROM project_documents WHERE id = $1',
        [documentId]
      )

      if (docResult.rows.length === 0) {
        throw new Error('Document not found')
      }

      const document = docResult.rows[0]
      const hasPermission = await this.checkProjectPermission(document.project_id, userId, 'write')
      if (!hasPermission) {
        throw new Error('Insufficient permissions to remove documents')
      }

      // Delete the document record
      await this.#db.query(
        'DELETE FROM project_documents WHERE id = $1',
        [documentId]
      )

      // Log document removal
      await this.logActivity({
        projectId: document.project_id,
        userId,
        action: 'document_removed',
        details: { documentId: document.document_id, name: document.name }
      })

      return true
    } catch (error) {
      console.error('Error removing document:', error)
      throw error
    }
  }

  /**
   * Check if user has permission for a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID
   * @param {string} permission - Permission to check (read, write, admin)
   * @returns {Promise<boolean>}
   */
  async checkProjectPermission(projectId, userId, permission = 'read') {
    try {
      const result = await this.#db.query(
        `SELECT 1 FROM projects p
         LEFT JOIN project_collaborators pc ON p.id = pc.project_id AND pc.user_id = $2
         WHERE p.id = $1 AND p.is_active = true
           AND (p.owner_id = $2 OR pc.user_id = $2)`,
        [projectId, userId]
      )

      return result.rows.length > 0
    } catch (error) {
      console.error('Error checking project permission:', error)
      return false
    }
  }

  /**
   * Log project activity
   * @param {Object} params
   * @param {string} params.projectId - Project ID
   * @param {string} [params.userId] - User ID
   * @param {string} [params.documentId] - Document ID
   * @param {string} params.action - Action performed
   * @param {Object} [params.details] - Additional details
   * @param {string} [params.ipAddress] - IP address
   */
  async logActivity({ projectId, userId, documentId, action, details = {}, ipAddress }) {
    try {
      await this.#db.query(
        `INSERT INTO project_activity_log (project_id, user_id, document_id, action, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [projectId, userId, documentId, action, JSON.stringify(details), ipAddress]
      )
    } catch (error) {
      console.error('Error logging project activity:', error)
      // Don't throw - logging failure shouldn't break the main operation
    }
  }

  /**
   * Format project data for API response
   * @param {Object} project - Raw project data
   * @param {Object} [options] - Formatting options
   * @returns {Object}
   */
  formatProject(project, options = {}) {
    const formatted = {
      id: project.id,
      name: project.name,
      description: project.description,
      settings: typeof project.settings === 'string' ? JSON.parse(project.settings) : project.settings,
      metadata: typeof project.metadata === 'string' ? JSON.parse(project.metadata) : project.metadata,
      isActive: project.is_active,
      createdAt: project.created_at,
      updatedAt: project.updated_at
    }

    if (project.owner_username) {
      formatted.owner = project.owner_username
    }

    if (options.includeDocumentCount && project.document_count !== undefined) {
      formatted.documentCount = parseInt(project.document_count)
    }

    return formatted
  }

  /**
   * Format document data for API response
   * @param {Object} document - Raw document data
   * @returns {Object}
   */
  formatDocument(document) {
    return {
      id: document.id,
      projectId: document.project_id,
      documentId: document.document_id,
      name: document.name,
      description: document.description,
      documentType: document.document_type,
      r2Prefix: document.r2_prefix,
      metadata: typeof document.metadata === 'string' ? JSON.parse(document.metadata) : document.metadata,
      sizeBytes: document.size_bytes,
      lastModified: document.last_modified,
      createdAt: document.created_at,
      updatedAt: document.updated_at
    }
  }
}

// Singleton instance
let projectServiceInstance = null

/**
 * Get the singleton ProjectService instance
 * @returns {ProjectService}
 */
export function getProjectService() {
  if (!projectServiceInstance) {
    projectServiceInstance = new ProjectService()
  }
  return projectServiceInstance
}
