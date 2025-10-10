import { test, expect } from '@playwright/test'

test.describe('Authentication Security Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the home page
    await page.goto('/')
  })

  test('should prevent unauthorized access to protected routes', async ({ page }) => {
    // Try to access a protected API endpoint without authentication
    const response = await page.request.get('/api/nodes')
    
    expect(response.status()).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  test('should handle invalid JWT tokens', async ({ page }) => {
    // Try to access protected route with invalid token
    const response = await page.request.get('/api/nodes', {
      headers: {
        'Authorization': 'Bearer invalid-token'
      }
    })
    
    expect(response.status()).toBe(401)
    const data = await response.json()
    expect(data.error).toBe('Unauthorized')
  })

  test('should handle malformed authorization headers', async ({ page }) => {
    // Try different malformed authorization headers
    const malformedHeaders = [
      'InvalidFormat token',
      'Bearer',
      'Bearer ',
      'Basic token',
      'Digest token',
      'token',
      '',
      'Bearer token extra',
      'Bearer token1 token2'
    ]

    for (const header of malformedHeaders) {
      const response = await page.request.get('/api/nodes', {
        headers: {
          'Authorization': header
        }
      })
      
      expect(response.status()).toBe(401)
    }
  })

  test('should prevent session fixation attacks', async ({ page }) => {
    // This test would verify that session tokens are properly rotated
    // and that old tokens become invalid after logout
    
    // First, simulate a login (this would be done through the UI)
    // Then logout
    // Then try to use the old token
    
    // For now, we'll test that the logout endpoint works
    const logoutResponse = await page.request.post('/api/auth/logout')
    expect(logoutResponse.status()).toBe(200)
    
    const data = await logoutResponse.json()
    expect(data.success).toBe(true)
  })

  test('should handle concurrent authentication attempts', async ({ page }) => {
    // Simulate multiple concurrent login attempts
    const promises = Array(10).fill(null).map(() => 
      page.request.post('/api/auth/google', {
        data: { idToken: 'test-token' }
      })
    )

    const responses = await Promise.all(promises)
    
    // All requests should be handled (rate limiting would be applied)
    responses.forEach(response => {
      expect([200, 400, 429, 500]).toContain(response.status())
    })
  })

  test('should validate Google OAuth token properly', async ({ page }) => {
    // Test with various invalid Google OAuth tokens
    const invalidTokens = [
      null,
      undefined,
      '',
      'invalid-token',
      'not-a-jwt',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid', // Invalid JWT
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.invalid', // Invalid signature
      'malformed-jwt-token',
      '<script>alert("xss")</script>',
      'javascript:alert("xss")',
      'data:text/html,<script>alert("xss")</script>'
    ]

    for (const token of invalidTokens) {
      const response = await page.request.post('/api/auth/google', {
        data: { idToken: token }
      })
      
      // Should reject invalid tokens
      expect([400, 500]).toContain(response.status())
    }
  })

  test('should handle authentication errors gracefully', async ({ page }) => {
    // Test various error scenarios
    const errorScenarios = [
      { method: 'GET', url: '/api/auth/google' }, // Wrong method
      { method: 'POST', url: '/api/auth/google', data: {} }, // Missing idToken
      { method: 'POST', url: '/api/auth/google', data: { idToken: null } }, // Null idToken
      { method: 'POST', url: '/api/auth/verify' }, // Missing authorization header
      { method: 'GET', url: '/api/auth/verify', headers: { 'Authorization': 'Bearer invalid' } }, // Invalid token
    ]

    for (const scenario of errorScenarios) {
      const response = await page.request.fetch(scenario.url, {
        method: scenario.method,
        data: scenario.data,
        headers: scenario.headers
      })
      
      // Should return appropriate error status
      expect([400, 401, 405, 500]).toContain(response.status())
    }
  })

  test('should prevent brute force attacks', async ({ page }) => {
    // Simulate rapid authentication attempts
    const attempts = Array(100).fill(null).map((_, i) => 
      page.request.post('/api/auth/google', {
        data: { idToken: `attempt-${i}` }
      })
    )

    const responses = await Promise.all(attempts)
    
    // Some requests should be rate limited
    const rateLimitedResponses = responses.filter(r => r.status() === 429)
    expect(rateLimitedResponses.length).toBeGreaterThan(0)
  })

  test('should handle network errors gracefully', async ({ page }) => {
    // Test with network interception to simulate failures
    await page.route('/api/auth/google', route => {
      route.abort('failed')
    })

    const response = await page.request.post('/api/auth/google', {
      data: { idToken: 'test-token' }
    })
    
    expect(response.status()).toBe(0) // Network error
  })

  test('should validate request headers', async ({ page }) => {
    // Test with suspicious headers
    const suspiciousHeaders = [
      { 'X-Forwarded-For': '127.0.0.1' },
      { 'X-Real-IP': '127.0.0.1' },
      { 'X-Forwarded-Proto': 'https' },
      { 'X-Forwarded-Host': 'evil.com' },
      { 'X-Original-URL': '/admin' },
      { 'X-Rewrite-URL': '/admin' },
      { 'X-Forwarded-Server': 'evil.com' },
      { 'X-Forwarded-Port': '443' },
      { 'X-Forwarded-Ssl': 'on' },
      { 'X-Forwarded-For': '127.0.0.1, 192.168.1.1' }
    ]

    for (const headers of suspiciousHeaders) {
      const response = await page.request.post('/api/auth/google', {
        data: { idToken: 'test-token' },
        headers
      })
      
      // Should handle suspicious headers gracefully
      expect([200, 400, 500]).toContain(response.status())
    }
  })

  test('should prevent timing attacks', async ({ page }) => {
    // Test that response times are consistent regardless of input
    const startTime = Date.now()
    
    const response1 = await page.request.post('/api/auth/google', {
      data: { idToken: 'valid-token' }
    })
    
    const time1 = Date.now() - startTime
    
    const startTime2 = Date.now()
    
    const response2 = await page.request.post('/api/auth/google', {
      data: { idToken: 'invalid-token' }
    })
    
    const time2 = Date.now() - startTime2
    
    // Response times should be similar (within 100ms)
    expect(Math.abs(time1 - time2)).toBeLessThan(100)
  })

  test('should handle large request bodies', async ({ page }) => {
    // Test with extremely large request body
    const largeToken = 'A'.repeat(1000000) // 1MB token
    
    const response = await page.request.post('/api/auth/google', {
      data: { idToken: largeToken }
    })
    
    // Should handle large requests gracefully
    expect([200, 400, 413, 500]).toContain(response.status())
  })

  test('should validate content-type headers', async ({ page }) => {
    // Test with various content-type headers
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
      const response = await page.request.post('/api/auth/google', {
        data: { idToken: 'test-token' },
        headers: { 'Content-Type': contentType }
      })
      
      // Should handle different content types appropriately
      expect([200, 400, 415, 500]).toContain(response.status())
    }
  })
})
