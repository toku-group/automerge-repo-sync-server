/**
 * Graph Analysis API Controller
 * Provides endpoints for querying Neo4j graph data and document analysis
 */

import { getNeo4jService } from '../database/Neo4jService.js'
import { authenticateToken } from '../auth/jwt.js'

export class GraphAnalysisController {
  
  /**
   * Get graph statistics
   */
  static async getStatistics(req, res) {
    try {
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      const stats = await neo4jService.getGraphStatistics()
      
      res.json({
        success: true,
        data: stats,
        message: 'Graph statistics retrieved successfully'
      })

    } catch (error) {
      console.error('Error getting graph statistics:', error)
      res.status(500).json({
        error: 'Failed to retrieve graph statistics',
        code: 'GRAPH_STATS_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Get document analysis from graph
   */
  static async getDocumentAnalysis(req, res) {
    try {
      const { documentId } = req.params
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      if (!documentId) {
        return res.status(400).json({
          error: 'Document ID is required',
          code: 'MISSING_DOCUMENT_ID'
        })
      }

      const analysis = await neo4jService.getDocumentAnalysis(documentId)
      
      if (!analysis) {
        return res.status(404).json({
          error: 'Document not found in graph database',
          code: 'DOCUMENT_NOT_FOUND'
        })
      }

      res.json({
        success: true,
        data: analysis,
        message: 'Document analysis retrieved successfully'
      })

    } catch (error) {
      console.error('Error getting document analysis:', error)
      res.status(500).json({
        error: 'Failed to retrieve document analysis',
        code: 'DOCUMENT_ANALYSIS_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Find similar documents
   */
  static async findSimilarDocuments(req, res) {
    try {
      const { documentId } = req.params
      const { limit = 10 } = req.query
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      if (!documentId) {
        return res.status(400).json({
          error: 'Document ID is required',
          code: 'MISSING_DOCUMENT_ID'
        })
      }

      const similarDocs = await neo4jService.findSimilarDocuments(
        documentId, 
        Math.min(parseInt(limit) || 10, 50) // Cap at 50
      )

      res.json({
        success: true,
        data: similarDocs,
        message: 'Similar documents found successfully'
      })

    } catch (error) {
      console.error('Error finding similar documents:', error)
      res.status(500).json({
        error: 'Failed to find similar documents',
        code: 'SIMILAR_DOCS_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Execute custom Cypher query (admin only)
   */
  static async executeQuery(req, res) {
    try {
      const { query, parameters = {} } = req.body
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      if (!query) {
        return res.status(400).json({
          error: 'Cypher query is required',
          code: 'MISSING_QUERY'
        })
      }

      // Security check - only allow read queries for safety
      const queryUpper = query.trim().toUpperCase()
      const writeOperations = ['CREATE', 'MERGE', 'SET', 'DELETE', 'REMOVE', 'DROP']
      const isWriteQuery = writeOperations.some(op => queryUpper.includes(op))

      if (isWriteQuery) {
        return res.status(403).json({
          error: 'Write operations are not allowed through this endpoint',
          code: 'WRITE_QUERY_FORBIDDEN'
        })
      }

      // Limit query results
      const limitedQuery = query.includes('LIMIT') ? query : `${query} LIMIT 1000`
      
      const results = await neo4jService.query(limitedQuery, parameters)

      res.json({
        success: true,
        data: results,
        message: 'Query executed successfully',
        resultCount: results.length
      })

    } catch (error) {
      console.error('Error executing Cypher query:', error)
      res.status(500).json({
        error: 'Failed to execute query',
        code: 'QUERY_EXECUTION_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Get document graph structure
   */
  static async getDocumentGraph(req, res) {
    try {
      const { documentId } = req.params
      const { depth = 2 } = req.query
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      if (!documentId) {
        return res.status(400).json({
          error: 'Document ID is required',
          code: 'MISSING_DOCUMENT_ID'
        })
      }

      const maxDepth = Math.min(parseInt(depth) || 2, 5) // Cap at 5 levels

      const query = `
        MATCH (d:Document {documentId: $documentId})
        OPTIONAL MATCH path = (d)-[:CONTAINS*1..${maxDepth}]->(n:AutomergeNode)
        OPTIONAL MATCH (n)-[r:RELATES_TO]->(related:AutomergeNode)
        WHERE related.documentId = $documentId
        
        RETURN d as document,
               collect(DISTINCT n) as nodes,
               collect(DISTINCT r) as relationships,
               collect(DISTINCT {
                 source: n.nodeId,
                 target: related.nodeId,
                 type: r.relType,
                 properties: r.properties
               }) as edges
      `

      const results = await neo4jService.query(query, { documentId })
      const result = results[0] || {}

      // Format for visualization
      const graphData = {
        document: result.document,
        nodes: (result.nodes || []).map(node => ({
          id: node.nodeId,
          type: node.nodeType,
          path: node.path,
          value: node.value,
          properties: JSON.parse(node.properties || '{}')
        })),
        edges: (result.edges || []).filter(edge => edge.source && edge.target)
      }

      res.json({
        success: true,
        data: graphData,
        message: 'Document graph structure retrieved successfully'
      })

    } catch (error) {
      console.error('Error getting document graph:', error)
      res.status(500).json({
        error: 'Failed to retrieve document graph',
        code: 'DOCUMENT_GRAPH_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Get node types distribution
   */
  static async getNodeTypesDistribution(req, res) {
    try {
      const { projectId } = req.query
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      let query = `
        MATCH (n:AutomergeNode)
      `
      
      const parameters = {}
      
      if (projectId) {
        query += `
        MATCH (d:Document {projectId: $projectId})-[:CONTAINS]->(n)
        `
        parameters.projectId = projectId
      }

      query += `
        RETURN n.nodeType as nodeType,
               count(n) as count,
               avg(size(n.value)) as avgValueSize
        ORDER BY count DESC
      `

      const results = await neo4jService.query(query, parameters)

      res.json({
        success: true,
        data: results,
        message: 'Node types distribution retrieved successfully'
      })

    } catch (error) {
      console.error('Error getting node types distribution:', error)
      res.status(500).json({
        error: 'Failed to retrieve node types distribution',
        code: 'NODE_TYPES_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Search nodes by content
   */
  static async searchNodes(req, res) {
    try {
      const { searchTerm, nodeType, limit = 50 } = req.query
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      if (!searchTerm) {
        return res.status(400).json({
          error: 'Search term is required',
          code: 'MISSING_SEARCH_TERM'
        })
      }

      let query = `
        MATCH (n:AutomergeNode)
        WHERE toLower(n.value) CONTAINS toLower($searchTerm)
      `
      
      const parameters = { searchTerm }
      
      if (nodeType) {
        query += ` AND n.nodeType = $nodeType`
        parameters.nodeType = nodeType
      }

      query += `
        MATCH (d:Document)-[:CONTAINS]->(n)
        RETURN n.nodeId as nodeId,
               n.nodeType as nodeType,
               n.path as path,
               n.value as value,
               d.documentId as documentId,
               d.title as documentTitle
        ORDER BY size(n.value) ASC
        LIMIT $limit
      `
      
      parameters.limit = Math.min(parseInt(limit) || 50, 200) // Cap at 200

      const results = await neo4jService.query(query, parameters)

      res.json({
        success: true,
        data: results,
        message: 'Node search completed successfully',
        resultCount: results.length
      })

    } catch (error) {
      console.error('Error searching nodes:', error)
      res.status(500).json({
        error: 'Failed to search nodes',
        code: 'NODE_SEARCH_ERROR',
        details: error.message
      })
    }
  }

  /**
   * Get relationship patterns
   */
  static async getRelationshipPatterns(req, res) {
    try {
      const { documentId, limit = 20 } = req.query
      const neo4jService = getNeo4jService()
      
      if (!neo4jService.isEnabled) {
        return res.status(503).json({
          error: 'Graph database service is not available',
          code: 'GRAPH_SERVICE_DISABLED'
        })
      }

      let query = `
        MATCH (a:AutomergeNode)-[r:RELATES_TO]->(b:AutomergeNode)
      `
      
      const parameters = {}
      
      if (documentId) {
        query += ` WHERE a.documentId = $documentId AND b.documentId = $documentId`
        parameters.documentId = documentId
      }

      query += `
        RETURN r.relType as relationshipType,
               a.nodeType as sourceType,
               b.nodeType as targetType,
               count(*) as frequency
        ORDER BY frequency DESC
        LIMIT $limit
      `
      
      parameters.limit = Math.min(parseInt(limit) || 20, 100)

      const results = await neo4jService.query(query, parameters)

      res.json({
        success: true,
        data: results,
        message: 'Relationship patterns retrieved successfully'
      })

    } catch (error) {
      console.error('Error getting relationship patterns:', error)
      res.status(500).json({
        error: 'Failed to retrieve relationship patterns',
        code: 'RELATIONSHIP_PATTERNS_ERROR',
        details: error.message
      })
    }
  }
}
