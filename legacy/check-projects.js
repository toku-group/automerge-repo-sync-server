#!/usr/bin/env node

import { getDatabaseService } from './src/database/DatabaseService.js'

async function checkProjectDeletion() {
  console.log('🔍 Checking project deletion functionality...')
  
  try {
    // Initialize database service
    const dbService = getDatabaseService()
    const initialized = await dbService.initialize()
    
    if (!initialized) {
      console.log('❌ Failed to initialize database service')
      process.exit(1)
    }
    
    console.log('✅ Database service initialized')
    
    // Check current projects
    const projects = await dbService.query(`
      SELECT id, name, is_active, created_at, updated_at 
      FROM projects 
      ORDER BY created_at DESC
    `)
    
    console.log('\n📋 Current projects in database:')
    if (projects.rows.length === 0) {
      console.log('   No projects found')
    } else {
      projects.rows.forEach(project => {
        console.log(`   - ${project.name} (ID: ${project.id})`)
        console.log(`     Active: ${project.is_active}`)
        console.log(`     Created: ${project.created_at}`)
        console.log(`     Updated: ${project.updated_at}`)
        console.log('')
      })
    }
    
    // Check project activity log
    const activities = await dbService.query(`
      SELECT pal.*, p.name as project_name, u.username
      FROM project_activity_log pal
      LEFT JOIN projects p ON pal.project_id = p.id
      LEFT JOIN users u ON pal.user_id = u.id
      ORDER BY pal.created_at DESC
      LIMIT 10
    `)
    
    console.log('📝 Recent project activities:')
    if (activities.rows.length === 0) {
      console.log('   No activities found')
    } else {
      activities.rows.forEach(activity => {
        console.log(`   - ${activity.action} on "${activity.project_name || 'Unknown'}" by ${activity.username || 'Unknown'}`)
        console.log(`     Time: ${activity.created_at}`)
        console.log(`     Details: ${JSON.stringify(activity.details)}`)
        console.log('')
      })
    }
    
    // Check for any documents
    const documents = await dbService.query(`
      SELECT pd.*, p.name as project_name
      FROM project_documents pd
      LEFT JOIN projects p ON pd.project_id = p.id
      ORDER BY pd.created_at DESC
    `)
    
    console.log('📄 Project documents:')
    if (documents.rows.length === 0) {
      console.log('   No documents found')
    } else {
      documents.rows.forEach(doc => {
        console.log(`   - ${doc.name} in project "${doc.project_name || 'Unknown'}"`)
        console.log(`     Document ID: ${doc.document_id}`)
        console.log(`     Created: ${doc.created_at}`)
        console.log('')
      })
    }
    
    process.exit(0)
  } catch (error) {
    console.error('❌ Error checking projects:', error)
    process.exit(1)
  }
}

checkProjectDeletion()
