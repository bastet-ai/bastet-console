import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Store active WebSocket connections
const connections = new Map<string, any>()

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // This is a placeholder for WebSocket handling
  // In a real implementation, you'd use a WebSocket library like 'ws'
  // or upgrade the HTTP connection to WebSocket
  
  res.status(200).json({ 
    message: 'WebSocket endpoint - use a WebSocket client to connect',
    endpoint: `ws://${req.headers.host}/api/ws/nodes`
  })
}

// WebSocket message handlers
export async function handleNodeRegistration(ws: any, data: any) {
  try {
    const { nodeId, nodeInfo, authToken } = data
    
    // Verify auth token
    const isValid = await verifyNodeAuthToken(authToken)
    if (!isValid) {
      ws.send(JSON.stringify({ error: 'Invalid authentication token' }))
      return
    }
    
    // Store node information in database
    const { error } = await supabase
      .from('bastet_nodes')
      .upsert({
        id: nodeId,
        info: nodeInfo,
        status: 'online',
        last_seen: new Date().toISOString(),
        websocket_connection: true
      })
    
    if (error) {
      console.error('Error storing node:', error)
      ws.send(JSON.stringify({ error: 'Failed to register node' }))
      return
    }
    
    // Store connection
    connections.set(nodeId, ws)
    
    ws.send(JSON.stringify({ 
      type: 'registration_success',
      message: 'Node registered successfully'
    }))
    
    console.log(`Node ${nodeId} registered successfully`)
  } catch (error) {
    console.error('Error in node registration:', error)
    ws.send(JSON.stringify({ error: 'Registration failed' }))
  }
}

export async function handleHeartbeat(ws: any, data: any) {
  try {
    const { nodeId, status } = data
    
    // Update last seen timestamp
    const { error } = await supabase
      .from('bastet_nodes')
      .update({ 
        last_seen: new Date().toISOString(),
        status: status || 'online'
      })
      .eq('id', nodeId)
    
    if (error) {
      console.error('Error updating heartbeat:', error)
    }
  } catch (error) {
    console.error('Error in heartbeat:', error)
  }
}

export async function handleScanResult(ws: any, data: any) {
  try {
    const { nodeId, scanId, results } = data
    
    // Store scan results
    const { error } = await supabase
      .from('scan_results')
      .insert({
        node_id: nodeId,
        scan_id: scanId,
        results: results,
        created_at: new Date().toISOString()
      })
    
    if (error) {
      console.error('Error storing scan results:', error)
      ws.send(JSON.stringify({ error: 'Failed to store scan results' }))
      return
    }
    
    ws.send(JSON.stringify({ 
      type: 'scan_result_received',
      scanId: scanId
    }))
    
    console.log(`Scan results received from node ${nodeId} for scan ${scanId}`)
  } catch (error) {
    console.error('Error in scan result handling:', error)
    ws.send(JSON.stringify({ error: 'Failed to process scan results' }))
  }
}

async function verifyNodeAuthToken(token: string): Promise<boolean> {
  try {
    // Implement your node authentication logic here
    // This could be JWT verification, API key validation, etc.
    jwt.verify(token, process.env.JWT_SECRET!)
    return true
  } catch {
    return false
  }
}

// Clean up disconnected nodes
export function cleanupConnection(nodeId: string) {
  connections.delete(nodeId)
  
  // Update node status to offline
  supabase
    .from('bastet_nodes')
    .update({ 
      status: 'offline',
      websocket_connection: false,
      last_seen: new Date().toISOString()
    })
    .eq('id', nodeId)
}
