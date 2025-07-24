-- Project management tables for Automerge Sync Server
-- This script adds project management functionality to the existing database

-- ====================================================================
-- PROJECT MANAGEMENT TABLES
-- ====================================================================

-- Projects table for managing Automerge document collections
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settings JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique project names per user
  CONSTRAINT unique_project_name_per_user UNIQUE(owner_id, name)
);

-- Project documents table for tracking Automerge documents in R2
CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id VARCHAR(255) NOT NULL, -- Automerge document ID in R2
  name VARCHAR(255) NOT NULL,
  description TEXT,
  document_type VARCHAR(100) DEFAULT 'automerge-document',
  r2_prefix VARCHAR(500), -- R2 storage prefix/path
  metadata JSONB DEFAULT '{}',
  size_bytes BIGINT,
  last_modified TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique document IDs across the system
  CONSTRAINT unique_document_id UNIQUE(document_id),
  -- Ensure unique document names per project
  CONSTRAINT unique_document_name_per_project UNIQUE(project_id, name)
);

-- Project collaborators table for access control
CREATE TABLE IF NOT EXISTS project_collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'collaborator', -- owner, admin, collaborator, viewer
  permissions TEXT[] DEFAULT ARRAY['read'],
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  
  -- Ensure unique collaborator per project
  CONSTRAINT unique_collaborator_per_project UNIQUE(project_id, user_id)
);

-- Project activity log for tracking changes
CREATE TABLE IF NOT EXISTS project_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  document_id UUID REFERENCES project_documents(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL, -- created, updated, deleted, document_added, document_removed, etc.
  details JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for project management performance
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(is_active);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_project_documents_project_id ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_document_id ON project_documents(document_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_type ON project_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_project_activity_project_id ON project_activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_project_activity_created ON project_activity_log(created_at);

-- Triggers for automatic timestamp updates (only if update function exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    -- Drop existing triggers if they exist
    DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
    DROP TRIGGER IF EXISTS update_project_documents_updated_at ON project_documents;
    
    -- Create new triggers
    CREATE TRIGGER update_projects_updated_at 
      BEFORE UPDATE ON projects 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER update_project_documents_updated_at 
      BEFORE UPDATE ON project_documents 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Function to get user projects with document counts
CREATE OR REPLACE FUNCTION get_user_projects(user_uuid UUID)
RETURNS TABLE (
  project_id UUID,
  project_name VARCHAR,
  description TEXT,
  role VARCHAR,
  document_count BIGINT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.description,
    CASE 
      WHEN p.owner_id = user_uuid THEN 'owner'
      ELSE COALESCE(pc.role, 'viewer')
    END as role,
    COUNT(pd.id) as document_count,
    p.created_at,
    p.updated_at
  FROM projects p
  LEFT JOIN project_collaborators pc ON p.id = pc.project_id AND pc.user_id = user_uuid
  LEFT JOIN project_documents pd ON p.id = pd.project_id
  WHERE p.is_active = true 
    AND (p.owner_id = user_uuid OR pc.user_id = user_uuid)
  GROUP BY p.id, p.name, p.description, p.owner_id, pc.role, p.created_at, p.updated_at
  ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup orphaned documents
CREATE OR REPLACE FUNCTION cleanup_orphaned_documents()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Mark documents as orphaned if their project is inactive
    UPDATE project_documents 
    SET metadata = metadata || '{"orphaned": true}'
    WHERE project_id IN (
      SELECT id FROM projects WHERE is_active = false
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
