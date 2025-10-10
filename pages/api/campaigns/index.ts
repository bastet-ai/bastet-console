import { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with service role key for backend operations
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Campaign creation request interface
interface CreateCampaignRequest {
  name: string
  description?: string
  scope: string
  privacy?: 'private' | 'public'
}

// Campaign response interface
interface CampaignResponse {
  id: string
  name: string
  description?: string
  scope: string
  status: string
  privacy: string
  owner_id: string
  created_at: string
  updated_at: string
}

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

// Validate campaign data
function validateCampaignData(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('Campaign name is required')
  } else if (data.name.length > 255) {
    errors.push('Campaign name must be 255 characters or less')
  }

  if (!data.scope || typeof data.scope !== 'string' || data.scope.trim().length === 0) {
    errors.push('Campaign scope is required')
  }

  if (data.description && typeof data.description !== 'string') {
    errors.push('Description must be a string')
  }

  if (data.privacy && !['private', 'public'].includes(data.privacy)) {
    errors.push('Privacy must be either "private" or "public"')
  }

  return { valid: errors.length === 0, errors }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    // Create new campaign
    try {
      // Verify user authentication
      const { userId, error: authError } = await verifyUser(req)
      if (authError) {
        return res.status(401).json({ error: authError })
      }

      // Validate request data
      const { valid, errors } = validateCampaignData(req.body)
      if (!valid) {
        return res.status(400).json({ error: 'Validation failed', details: errors })
      }

      const { name, description, scope, privacy = 'private' }: CreateCampaignRequest = req.body

      // Create campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .insert([{
          name: name.trim(),
          description: description?.trim(),
          scope: scope.trim(),
          privacy,
          owner_id: userId
        }])
        .select()
        .single()

      if (campaignError) {
        console.error('Campaign creation error:', campaignError)
        return res.status(500).json({ error: 'Failed to create campaign', details: campaignError })
      }

      // Add owner as campaign member with 'owner' role
      const { error: memberError } = await supabase
        .from('campaign_members')
        .insert([{
          campaign_id: campaign.id,
          user_id: userId,
          role: 'owner'
        }])

      if (memberError) {
        console.error('Campaign member creation error:', memberError)
        // Don't fail the request, but log the error
        console.warn('Failed to add owner as campaign member')
      }

      res.status(201).json({
        success: true,
        campaign: campaign as CampaignResponse
      })

    } catch (error) {
      console.error('Campaign creation error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else if (req.method === 'GET') {
    // Get user's campaigns
    try {
      // Verify user authentication
      const { userId, error: authError } = await verifyUser(req)
      if (authError) {
        return res.status(401).json({ error: authError })
      }

      // Get campaigns where user is a member
      const { data: campaigns, error: campaignsError } = await supabase
        .from('campaigns')
        .select(`
          *,
          campaign_members!inner(role)
        `)
        .eq('campaign_members.user_id', userId)
        .order('created_at', { ascending: false })

      if (campaignsError) {
        console.error('Campaigns fetch error:', campaignsError)
        return res.status(500).json({ error: 'Failed to fetch campaigns', details: campaignsError })
      }

      res.json({
        success: true,
        campaigns: campaigns || []
      })

    } catch (error) {
      console.error('Campaigns fetch error:', error)
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }

  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}
