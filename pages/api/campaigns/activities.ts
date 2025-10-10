import { NextApiRequest, NextApiResponse } from 'next'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    // Verify JWT token
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

    if (!decoded.userId) {
      return res.status(401).json({ success: false, error: 'Invalid token' })
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get query parameters
    const { campaign_id, limit = 50, offset = 0 } = req.query

    // Build query
    let query = supabase
      .from('campaign_activities')
      .select(`
        id,
        campaign_id,
        user_id,
        activity_type,
        activity_data,
        created_at,
        campaigns!inner(
          id,
          name,
          privacy
        ),
        users!inner(
          id,
          name,
          email,
          avatar_url
        )
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit as string))
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1)

    // Filter by campaign if specified
    if (campaign_id) {
      query = query.eq('campaign_id', campaign_id)
    } else {
      // If no specific campaign, get activities from all campaigns the user is a member of
      const { data: userCampaigns } = await supabase
        .from('campaign_members')
        .select('campaign_id')
        .eq('user_id', decoded.userId)

      if (userCampaigns && userCampaigns.length > 0) {
        const campaignIds = userCampaigns.map(c => c.campaign_id)
        query = query.in('campaign_id', campaignIds)
      } else {
        // User has no campaigns, return empty array
        return res.status(200).json({ success: true, activities: [] })
      }
    }

    const { data: activities, error } = await query

    if (error) {
      console.error('Error fetching activities:', error)
      return res.status(500).json({ success: false, error: 'Failed to fetch activities' })
    }

    // Format activities for the frontend
    const formattedActivities = activities?.map((activity: any) => ({
      id: activity.id,
      campaign_id: activity.campaign_id,
      campaign_name: activity.campaigns?.name,
      campaign_privacy: activity.campaigns?.privacy,
      user_id: activity.user_id,
      user_name: activity.users?.name,
      user_email: activity.users?.email,
      user_avatar: activity.users?.avatar_url,
      activity_type: activity.activity_type,
      activity_data: activity.activity_data,
      created_at: activity.created_at
    })) || []

    res.status(200).json({ success: true, activities: formattedActivities })

  } catch (error) {
    console.error('Activities API error:', error)
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
