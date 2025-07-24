#!/usr/bin/env node

import fs from 'fs'
import { getDatabaseService } from './src/database/DatabaseService.js'

async function updateSchema() {
  console.log('🔧 Updating database schema with project tables...')
  
  try {
    // Initialize database service
    const dbService = getDatabaseService()
    const initialized = await dbService.initialize()
    
    if (!initialized) {
      console.log('❌ Failed to initialize database service')
      process.exit(1)
    }
    
    console.log('✅ Database service initialized')
    
    // Read the schema file
    const schemaSQL = fs.readFileSync('./database/project-schema.sql', 'utf8')
    
    // Execute the schema
    console.log('📊 Executing schema updates...')
    await dbService.query(schemaSQL)
    
    console.log('✅ Schema updated successfully!')
    console.log('📋 New tables created:')
    console.log('   - projects')
    console.log('   - project_documents') 
    console.log('   - project_collaborators')
    console.log('   - project_activity_log')
    
    // Test the new tables
    const result = await dbService.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('projects', 'project_documents', 'project_collaborators', 'project_activity_log')
      ORDER BY table_name
    `)
    
    console.log('✅ Verified tables exist:', result.rows.map(r => r.table_name))
    
    process.exit(0)
  } catch (error) {
    console.error('❌ Error updating schema:', error)
    process.exit(1)
  }
}

updateSchema()
