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

// Helper function to check if user has access to campaign
async function checkCampaignAccess(campaignId: string, userId: string): Promise<{ hasAccess: boolean; role?: string; error?: string }> {
  try {
    const { data: member, error } = await supabase
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .single()

    if (error) {
      return { hasAccess: false, error: 'Access denied' }
    }

    return { hasAccess: true, role: member.role }
  } catch (error) {
    return { hasAccess: false, error: 'Failed to check access' }
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
    // Get campaign details
    try {
      // Check if user has access to campaign
      const { hasAccess, role, error: accessError } = await checkCampaignAccess(id, userId)
      if (!hasAccess) {
        return res.status(403).json({ error: accessError || 'Access denied' })
      }

      // Get campaign with members
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select(`
          *,
          campaign_members(
            role,
            joined_at,
            users(
              id,
              name,
              email,
              avatar_url
            )
          )
        `)
        .eq('id', id)
        .single()

      if (campaignError) {
        console.error('Campaign fetch error:', campaignError)
        return res.status(404).json({ error: 'Campaign not found' })
      }

      res.json({
        success: true,
        campaign: {
          ...campaign,
          userRole: role
        }
      })

    } catch (error) {
      console.error('Campaign fetch error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else if (req.method === 'PUT') {
    // Update campaign
    try {
      // Check if user has access and is owner/manager
      const { hasAccess, role, error: accessError } = await checkCampaignAccess(id, userId)
      if (!hasAccess) {
        return res.status(403).json({ error: accessError || 'Access denied' })
      }

      if (!['owner', 'manager'].includes(role!)) {
        return res.status(403).json({ error: 'Only owners and managers can update campaigns' })
      }

      // Validate update data
      const { name, description, scope, privacy, status } = req.body
      const updateData: any = {}

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'Campaign name is required' })
        }
        updateData.name = name.trim()
      }

      if (description !== undefined) {
        if (typeof description !== 'string') {
          return res.status(400).json({ error: 'Description must be a string' })
        }
        updateData.description = description.trim()
      }

      if (scope !== undefined) {
        if (typeof scope !== 'string' || scope.trim().length === 0) {
          return res.status(400).json({ error: 'Campaign scope is required' })
        }
        updateData.scope = scope.trim()
      }

      if (privacy !== undefined) {
        if (!['private', 'public'].includes(privacy)) {
          return res.status(400).json({ error: 'Privacy must be either "private" or "public"' })
        }
        updateData.privacy = privacy
      }

      if (status !== undefined) {
        if (!['active', 'paused', 'completed', 'archived'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status' })
        }
        updateData.status = status
      }

      // Update campaign
      const { data: campaign, error: updateError } = await supabase
        .from('campaigns')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (updateError) {
        console.error('Campaign update error:', updateError)
        return res.status(500).json({ error: 'Failed to update campaign', details: updateError })
      }

      res.json({
        success: true,
        campaign
      })

    } catch (error) {
      console.error('Campaign update error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else if (req.method === 'DELETE') {
    // Delete campaign (only owner)
    try {
      // Check if user is owner
      const { hasAccess, role, error: accessError } = await checkCampaignAccess(id, userId)
      if (!hasAccess) {
        return res.status(403).json({ error: accessError || 'Access denied' })
      }

      if (role !== 'owner') {
        return res.status(403).json({ error: 'Only campaign owners can delete campaigns' })
      }

      // Delete campaign (cascade will handle related records)
      const { error: deleteError } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', id)

      if (deleteError) {
        console.error('Campaign delete error:', deleteError)
        return res.status(500).json({ error: 'Failed to delete campaign', details: deleteError })
      }

      res.json({
        success: true,
        message: 'Campaign deleted successfully'
      })

    } catch (error) {
      console.error('Campaign delete error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
