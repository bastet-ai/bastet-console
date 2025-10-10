import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import expressWs from 'express-ws';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

// Import route handlers
import authRoutes from './routes/auth.js';
import nodeRoutes from './routes/nodes.js';
import scanRoutes from './routes/scans.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize WebSocket support
expressWs(app);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role key for backend
);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/scans', scanRoutes);

// WebSocket endpoint for real-time node communication
app.ws('/ws/nodes', (ws, req) => {
  console.log('New node connection established');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received from node:', data);
      
      // Handle different message types
      switch (data.type) {
        case 'node_register':
          await handleNodeRegistration(ws, data);
          break;
        case 'heartbeat':
          await handleHeartbeat(ws, data);
          break;
        case 'scan_result':
          await handleScanResult(ws, data);
          break;
        default:
          ws.send(JSON.stringify({ error: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    console.log('Node connection closed');
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// WebSocket message handlers
async function handleNodeRegistration(ws, data) {
  try {
    const { nodeId, nodeInfo, authToken } = data;
    
    // Verify auth token
    const isValid = await verifyNodeAuthToken(authToken);
    if (!isValid) {
      ws.send(JSON.stringify({ error: 'Invalid authentication token' }));
      return;
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
      });
    
    if (error) {
      console.error('Error storing node:', error);
      ws.send(JSON.stringify({ error: 'Failed to register node' }));
      return;
    }
    
    ws.send(JSON.stringify({ 
      type: 'registration_success',
      message: 'Node registered successfully'
    }));
    
    console.log(`Node ${nodeId} registered successfully`);
  } catch (error) {
    console.error('Error in node registration:', error);
    ws.send(JSON.stringify({ error: 'Registration failed' }));
  }
}

async function handleHeartbeat(ws, data) {
  try {
    const { nodeId, status } = data;
    
    // Update last seen timestamp
    const { error } = await supabase
      .from('bastet_nodes')
      .update({ 
        last_seen: new Date().toISOString(),
        status: status || 'online'
      })
      .eq('id', nodeId);
    
    if (error) {
      console.error('Error updating heartbeat:', error);
    }
  } catch (error) {
    console.error('Error in heartbeat:', error);
  }
}

async function handleScanResult(ws, data) {
  try {
    const { nodeId, scanId, results } = data;
    
    // Store scan results
    const { error } = await supabase
      .from('scan_results')
      .insert({
        node_id: nodeId,
        scan_id: scanId,
        results: results,
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error('Error storing scan results:', error);
      ws.send(JSON.stringify({ error: 'Failed to store scan results' }));
      return;
    }
    
    ws.send(JSON.stringify({ 
      type: 'scan_result_received',
      scanId: scanId
    }));
    
    console.log(`Scan results received from node ${nodeId} for scan ${scanId}`);
  } catch (error) {
    console.error('Error in scan result handling:', error);
    ws.send(JSON.stringify({ error: 'Failed to process scan results' }));
  }
}

async function verifyNodeAuthToken(token) {
  // Implement your node authentication logic here
  // This could be JWT verification, API key validation, etc.
  return true; // Placeholder
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Bastet Console Backend running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws/nodes`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

export default app;
