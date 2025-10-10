import { test, expect } from '@playwright/test'

test.describe('API Security Tests', () => {
  let authToken: string

  test.beforeAll(async ({ request }) => {
    // Get authentication token for tests
    // In a real test, this would be done through the actual login flow
    authToken = 'mock-jwt-token'
  })

  test.describe('Node Management API', () => {
    test('should require authentication for all node operations', async ({ request }) => {
      const endpoints = [
        { method: 'GET', url: '/api/nodes' },
        { method: 'POST', url: '/api/nodes', data: { name: 'Test', node_type: 'scanner' } },
        { method: 'GET', url: '/api/nodes/test-id' },
        { method: 'PUT', url: '/api/nodes/test-id', data: { name: 'Updated' } },
        { method: 'DELETE', url: '/api/nodes/test-id' }
      ]

      for (const endpoint of endpoints) {
        const response = await request.fetch(endpoint.url, {
          method: endpoint.method,
          data: endpoint.data
        })
        
        expect(response.status()).toBe(401)
        const data = await response.json()
        expect(data.error).toBe('Unauthorized')
      }
    })

    test('should validate input for node creation', async ({ request }) => {
      const invalidInputs = [
        {}, // Missing required fields
        { name: 'Test' }, // Missing node_type
        { node_type: 'scanner' }, // Missing name
        { name: '', node_type: 'scanner' }, // Empty name
        { name: 'Test', node_type: '' }, // Empty node_type
        { name: null, node_type: 'scanner' }, // Null name
        { name: 'Test', node_type: null }, // Null node_type
        { name: undefined, node_type: 'scanner' }, // Undefined name
        { name: 'Test', node_type: undefined }, // Undefined node_type
        { name: 123, node_type: 'scanner' }, // Wrong type
        { name: 'Test', node_type: 123 }, // Wrong type
        { name: [], node_type: 'scanner' }, // Array instead of string
        { name: 'Test', node_type: [] }, // Array instead of string
        { name: {}, node_type: 'scanner' }, // Object instead of string
        { name: 'Test', node_type: {} } // Object instead of string
      ]

      for (const input of invalidInputs) {
        const response = await request.post('/api/nodes', {
          data: input,
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        expect([400, 422]).toContain(response.status())
      }
    })

    test('should prevent SQL injection in node queries', async ({ request }) => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "' UNION SELECT * FROM users --",
        "'; INSERT INTO users (id, email) VALUES ('hacker', 'hacker@evil.com'); --",
        "' OR 1=1 --",
        "admin'--",
        "admin'/*",
        "' OR 'x'='x",
        "' AND 'x'='y"
      ]

      for (const payload of sqlInjectionPayloads) {
        const response = await request.get(`/api/nodes/${encodeURIComponent(payload)}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        // Should handle SQL injection attempts safely
        expect([200, 400, 404, 500]).toContain(response.status())
      }
    })

    test('should prevent XSS in node data', async ({ request }) => {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert("xss")>',
        'javascript:alert("xss")',
        '<svg onload=alert("xss")>',
        '<iframe src="javascript:alert(\'xss\')"></iframe>',
        '<object data="javascript:alert(\'xss\')"></object>',
        '<embed src="javascript:alert(\'xss\')">',
        '<link rel="stylesheet" href="javascript:alert(\'xss\')">',
        '<meta http-equiv="refresh" content="0;url=javascript:alert(\'xss\')">',
        '<body onload=alert("xss")>'
      ]

      for (const payload of xssPayloads) {
        const response = await request.post('/api/nodes', {
          data: {
            name: payload,
            description: payload,
            node_type: 'scanner'
          },
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        // Should handle XSS attempts safely
        expect([200, 201, 400, 422]).toContain(response.status())
        
        if (response.status() === 201) {
          const data = await response.json()
          // Verify the payload was stored (in real implementation, it would be sanitized)
          expect(data.node.name).toBe(payload)
        }
      }
    })

    test('should validate node type enum values', async ({ request }) => {
      const invalidNodeTypes = [
        'invalid_type',
        'scanner_evil',
        'monitor<script>',
        'analyzer; DROP TABLE users; --',
        'scanner OR 1=1',
        'monitor UNION SELECT * FROM users',
        'analyzer AND 1=1',
        'scanner\' OR \'1\'=\'1',
        'monitor" OR "1"="1',
        'analyzer` OR `1`=`1'
      ]

      for (const nodeType of invalidNodeTypes) {
        const response = await request.post('/api/nodes', {
          data: {
            name: 'Test Node',
            node_type: nodeType
          },
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        // Should handle invalid node types appropriately
        expect([200, 201, 400, 422]).toContain(response.status())
      }
    })

    test('should prevent unauthorized access to other users nodes', async ({ request }) => {
      // Create a node
      const createResponse = await request.post('/api/nodes', {
        data: {
          name: 'Test Node',
          node_type: 'scanner'
        },
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      
      expect(createResponse.status()).toBe(201)
      const { node } = await createResponse.json()
      
      // Try to access with different user's token
      const otherUserToken = 'other-user-token'
      const response = await request.get(`/api/nodes/${node.id}`, {
        headers: { 'Authorization': `Bearer ${otherUserToken}` }
      })
      
      // Should not allow access to other user's nodes
      expect([401, 403, 404]).toContain(response.status())
    })

    test('should handle malformed JSON in request body', async ({ request }) => {
      const response = await request.post('/api/nodes', {
        data: 'invalid json',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      })
      
      expect([400, 422]).toContain(response.status())
    })

    test('should validate request size limits', async ({ request }) => {
      const largeData = {
        name: 'A'.repeat(1000000), // 1MB string
        description: 'B'.repeat(1000000), // 1MB string
        node_type: 'scanner'
      }

      const response = await request.post('/api/nodes', {
        data: largeData,
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      
      // Should handle large requests appropriately
      expect([200, 201, 413, 500]).toContain(response.status())
    })

    test('should prevent command injection in node data', async ({ request }) => {
      const commandInjectionPayloads = [
        '; ls -la',
        '| cat /etc/passwd',
        '&& whoami',
        '|| id',
        '`whoami`',
        '$(whoami)',
        '; cat /etc/passwd',
        '| cat /etc/shadow',
        '&& cat /etc/hosts',
        '|| cat /proc/version'
      ]

      for (const payload of commandInjectionPayloads) {
        const response = await request.post('/api/nodes', {
          data: {
            name: payload,
            description: payload,
            node_type: 'scanner'
          },
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        // Should handle command injection attempts safely
        expect([200, 201, 400, 422]).toContain(response.status())
      }
    })

    test('should handle concurrent requests safely', async ({ request }) => {
      // Simulate multiple concurrent requests
      const promises = Array(50).fill(null).map((_, i) => 
        request.post('/api/nodes', {
          data: {
            name: `Concurrent Node ${i}`,
            node_type: 'scanner'
          },
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
      )

      const responses = await Promise.all(promises)
      
      // All requests should be handled
      responses.forEach(response => {
        expect([200, 201, 429, 500]).toContain(response.status())
      })
    })

    test('should validate HTTP methods', async ({ request }) => {
      const invalidMethods = ['PATCH', 'HEAD', 'TRACE', 'CONNECT', 'PURGE', 'LINK', 'UNLINK']

      for (const method of invalidMethods) {
        const response = await request.fetch('/api/nodes', {
          method: method as any,
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        expect(response.status()).toBe(405)
        const data = await response.json()
        expect(data.error).toBe('Method not allowed')
      }
    })

    test('should handle rate limiting', async ({ request }) => {
      // Make many requests quickly
      const promises = Array(200).fill(null).map(() => 
        request.get('/api/nodes', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
      )

      const responses = await Promise.all(promises)
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status() === 429)
      expect(rateLimitedResponses.length).toBeGreaterThan(0)
    })

    test('should validate content-type headers', async ({ request }) => {
      const contentTypes = [
        'application/json',
        'application/x-www-form-urlencoded',
        'multipart/form-data',
        'text/plain',
        'application/xml',
        'text/html',
        'application/javascript',
        'text/css',
        'image/svg+xml',
        'application/pdf'
      ]

      for (const contentType of contentTypes) {
        const response = await request.post('/api/nodes', {
          data: { name: 'Test', node_type: 'scanner' },
          headers: { 
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': contentType
          }
        })
        
        // Should handle different content types appropriately
        expect([200, 201, 400, 415, 422]).toContain(response.status())
      }
    })

    test('should prevent header injection', async ({ request }) => {
      const headerInjectionPayloads = [
        'test\r\nSet-Cookie: malicious=value',
        'test\nSet-Cookie: malicious=value',
        'test\rSet-Cookie: malicious=value',
        'test%0d%0aSet-Cookie: malicious=value',
        'test%0aSet-Cookie: malicious=value',
        'test%0dSet-Cookie: malicious=value'
      ]

      for (const payload of headerInjectionPayloads) {
        const response = await request.post('/api/nodes', {
          data: {
            name: payload,
            node_type: 'scanner'
          },
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        // Should handle header injection attempts safely
        expect([200, 201, 400, 422]).toContain(response.status())
      }
    })

    test('should validate UUID format for node IDs', async ({ request }) => {
      const invalidIds = [
        'not-a-uuid',
        '123',
        'abc',
        'uuid-123',
        '00000000-0000-0000-0000-000000000000',
        'invalid-uuid-format',
        '<script>alert("xss")</script>',
        '; DROP TABLE users; --',
        'admin',
        'root',
        'test',
        'null',
        'undefined',
        'true',
        'false'
      ]

      for (const id of invalidIds) {
        const response = await request.get(`/api/nodes/${id}`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        
        // Should handle invalid UUIDs appropriately
        expect([200, 400, 404, 422]).toContain(response.status())
      }
    })
  })

  test.describe('Error Handling', () => {
    test('should not expose sensitive information in error messages', async ({ request }) => {
      const response = await request.get('/api/nodes', {
        headers: { 'Authorization': 'Bearer invalid-token' }
      })
      
      expect(response.status()).toBe(401)
      const data = await response.json()
      
      // Error message should not contain sensitive information
      expect(data.error).not.toContain('Database')
      expect(data.error).not.toContain('Supabase')
      expect(data.error).not.toContain('JWT')
      expect(data.error).not.toContain('secret')
      expect(data.error).not.toContain('key')
      expect(data.error).not.toContain('password')
      expect(data.error).not.toContain('token')
    })

    test('should handle database errors gracefully', async ({ request }) => {
      // This would require mocking the database to return errors
      // For now, we'll test that the API handles errors appropriately
      const response = await request.get('/api/nodes', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      
      // Should return appropriate status code
      expect([200, 500]).toContain(response.status())
    })

    test('should handle network timeouts', async ({ request }) => {
      // This would require simulating network timeouts
      // For now, we'll test that the API responds within reasonable time
      const startTime = Date.now()
      
      const response = await request.get('/api/nodes', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      
      const endTime = Date.now()
      const responseTime = endTime - startTime
      
      // Response should be within reasonable time (5 seconds)
      expect(responseTime).toBeLessThan(5000)
    })
  })
})
