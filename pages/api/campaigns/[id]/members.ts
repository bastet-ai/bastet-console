import { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with service role key for backend operations
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper function to verify JWT token and get user
async function verifyUser(req: NextApiRequest): Promise<{ userId: string; error?: string }> {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { userId: '', error: 'No authorization token provided' }
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    
    return { userId: decoded.userId }
  } catch (error) {
    return { userId: '', error: 'Invalid token' }
  }
}

// Helper function to check if user can manage campaign members
async function canManageMembers(campaignId: string, userId: string): Promise<{ canManage: boolean; error?: string }> {
  try {
    const { data: member, error } = await supabase
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .single()

    if (error) {
      return { canManage: false, error: 'Access denied' }
    }

    if (!['owner', 'manager'].includes(member.role)) {
      return { canManage: false, error: 'Only owners and managers can manage members' }
    }

    return { canManage: true }
  } catch (error) {
    return { canManage: false, error: 'Failed to check permissions' }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' })
  }

  // Verify user authentication
  const { userId, error: authError } = await verifyUser(req)
  if (authError) {
    return res.status(401).json({ error: authError })
  }

  if (req.method === 'GET') {
    // Get campaign members
    try {
      // Check if user has access to campaign
      const { data: member, error: memberError } = await supabase
        .from('campaign_members')
        .select('role')
        .eq('campaign_id', id)
        .eq('user_id', userId)
        .single()

      if (memberError) {
        return res.status(403).json({ error: 'Access denied' })
      }

      // Get all campaign members
      const { data: members, error: membersError } = await supabase
        .from('campaign_members')
        .select(`
          id,
          role,
          joined_at,
          users(
            id,
            name,
            email,
            avatar_url
          )
        `)
        .eq('campaign_id', id)
        .order('joined_at', { ascending: true })

      if (membersError) {
        console.error('Members fetch error:', membersError)
        return res.status(500).json({ error: 'Failed to fetch members', details: membersError })
      }

      res.json({
        success: true,
        members: members || [],
        userRole: member.role
      })

    } catch (error) {
      console.error('Members fetch error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else if (req.method === 'POST') {
    // Add member to campaign
    try {
      // Check if user can manage members
      const { canManage, error: permissionError } = await canManageMembers(id, userId)
      if (!canManage) {
        return res.status(403).json({ error: permissionError || 'Permission denied' })
      }

      const { user_id, role = 'watcher' } = req.body

      if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' })
      }

      if (!['owner', 'manager', 'collaborator', 'watcher'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' })
      }

      // Check if user is already a member
      const { data: existingMember, error: checkError } = await supabase
        .from('campaign_members')
        .select('id')
        .eq('campaign_id', id)
        .eq('user_id', user_id)
        .single()

      if (existingMember) {
        return res.status(400).json({ error: 'User is already a member of this campaign' })
      }

      // Add member
      const { data: member, error: addError } = await supabase
        .from('campaign_members')
        .insert([{
          campaign_id: id,
          user_id,
          role
        }])
        .select(`
          id,
          role,
          joined_at,
          users(
            id,
            name,
            email,
            avatar_url
          )
        `)
        .single()

      if (addError) {
        console.error('Member add error:', addError)
        return res.status(500).json({ error: 'Failed to add member', details: addError })
      }

      res.status(201).json({
        success: true,
        member
      })

    } catch (error) {
      console.error('Member add error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else if (req.method === 'PUT') {
    // Update member role
    try {
      // Check if user can manage members
      const { canManage, error: permissionError } = await canManageMembers(id, userId)
      if (!canManage) {
        return res.status(403).json({ error: permissionError || 'Permission denied' })
      }

      const { member_id, role } = req.body

      if (!member_id || !role) {
        return res.status(400).json({ error: 'Member ID and role are required' })
      }

      if (!['owner', 'manager', 'collaborator', 'watcher'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' })
      }

      // Update member role
      const { data: member, error: updateError } = await supabase
        .from('campaign_members')
        .update({ role })
        .eq('id', member_id)
        .eq('campaign_id', id)
        .select(`
          id,
          role,
          joined_at,
          users(
            id,
            name,
            email,
            avatar_url
          )
        `)
        .single()

      if (updateError) {
        console.error('Member update error:', updateError)
        return res.status(500).json({ error: 'Failed to update member', details: updateError })
      }

      res.json({
        success: true,
        member
      })

    } catch (error) {
      console.error('Member update error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else if (req.method === 'DELETE') {
    // Remove member from campaign
    try {
      // Check if user can manage members
      const { canManage, error: permissionError } = await canManageMembers(id, userId)
      if (!canManage) {
        return res.status(403).json({ error: permissionError || 'Permission denied' })
      }

      const { member_id } = req.body

      if (!member_id) {
        return res.status(400).json({ error: 'Member ID is required' })
      }

      // Remove member
      const { error: deleteError } = await supabase
        .from('campaign_members')
        .delete()
        .eq('id', member_id)
        .eq('campaign_id', id)

      if (deleteError) {
        console.error('Member delete error:', deleteError)
        return res.status(500).json({ error: 'Failed to remove member', details: deleteError })
      }

      res.json({
        success: true,
        message: 'Member removed successfully'
      })

    } catch (error) {
      console.error('Member delete error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
