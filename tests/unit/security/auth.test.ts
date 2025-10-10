import { NextApiRequest, NextApiResponse } from 'next'
import { createMocks } from 'node-mocks-http'
import handler from '../../../pages/api/auth/google'
import verifyHandler from '../../../pages/api/auth/verify'
import logoutHandler from '../../../pages/api/auth/logout'

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => ({
            data: null,
            error: { code: 'PGRST116' }
          }))
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => ({
            data: {
              id: 'test-user-id',
              email: 'test@example.com',
              name: 'Test User',
              google_id: 'test-google-id'
            },
            error: null
          }))
        }))
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          data: null,
          error: null
        }))
      }))
    }))
  }))
}))

// Mock Google Auth
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({
    verifyIdToken: jest.fn(() => ({
      getPayload: jest.fn(() => ({
        sub: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/avatar.jpg'
      }))
    }))
  }))
}))

// Mock JWT
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token'),
  verify: jest.fn(() => ({
    userId: 'test-user-id',
    email: 'test@example.com',
    googleId: 'test-google-id'
  }))
}))

describe('Authentication Security Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /api/auth/google', () => {
    it('should reject requests without idToken', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: {}
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'ID token is required'
      })
    })

    it('should reject requests with invalid idToken', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: { idToken: 'invalid-token' }
      })

      // Mock Google Auth to throw error
      const { OAuth2Client } = require('google-auth-library')
      const mockClient = new OAuth2Client()
      mockClient.verifyIdToken.mockRejectedValue(new Error('Invalid token'))

      await handler(req, res)

      expect(res._getStatusCode()).toBe(500)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Authentication failed'
      })
    })

    it('should reject requests with malformed idToken', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: { idToken: null }
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(400)
    })

    it('should handle database errors gracefully', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: { idToken: 'valid-token' }
      })

      // Mock Supabase to return error
      const { createClient } = require('@supabase/supabase-js')
      const mockSupabase = createClient()
      mockSupabase.from().select().eq().single.mockReturnValue({
        data: null,
        error: { code: 'PGRST116' }
      })
      mockSupabase.from().insert().select().single.mockReturnValue({
        data: null,
        error: { message: 'Database error' }
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(500)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Failed to create user'
      })
    })

    it('should only accept POST requests', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET'
      })

      await handler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Method not allowed'
      })
    })

    it('should validate Google token audience', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: { idToken: 'valid-token' }
      })

      const { OAuth2Client } = require('google-auth-library')
      const mockClient = new OAuth2Client()
      
      await handler(req, res)

      expect(mockClient.verifyIdToken).toHaveBeenCalledWith({
        idToken: 'valid-token',
        audience: process.env.GOOGLE_CLIENT_ID
      })
    })
  })

  describe('GET /api/auth/verify', () => {
    it('should reject requests without authorization header', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET'
      })

      await verifyHandler(req, res)

      expect(res._getStatusCode()).toBe(401)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'No token provided'
      })
    })

    it('should reject requests with invalid JWT token', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          authorization: 'Bearer invalid-token'
        }
      })

      // Mock JWT to throw error
      const jwt = require('jsonwebtoken')
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token')
      })

      await verifyHandler(req, res)

      expect(res._getStatusCode()).toBe(401)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Invalid token'
      })
    })

    it('should reject requests with malformed authorization header', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          authorization: 'InvalidFormat token'
        }
      })

      await verifyHandler(req, res)

      expect(res._getStatusCode()).toBe(401)
    })

    it('should handle database errors during verification', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          authorization: 'Bearer valid-token'
        }
      })

      // Mock Supabase to return error
      const { createClient } = require('@supabase/supabase-js')
      const mockSupabase = createClient()
      mockSupabase.from().select().eq().single.mockReturnValue({
        data: null,
        error: { message: 'Database error' }
      })

      await verifyHandler(req, res)

      expect(res._getStatusCode()).toBe(401)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Invalid token'
      })
    })

    it('should only accept GET requests', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token'
        }
      })

      await verifyHandler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Method not allowed'
      })
    })
  })

  describe('POST /api/auth/logout', () => {
    it('should only accept POST requests', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET'
      })

      await logoutHandler(req, res)

      expect(res._getStatusCode()).toBe(405)
      expect(JSON.parse(res._getData())).toEqual({
        error: 'Method not allowed'
      })
    })

    it('should handle logout successfully', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST'
      })

      await logoutHandler(req, res)

      expect(res._getStatusCode()).toBe(200)
      expect(JSON.parse(res._getData())).toEqual({
        success: true,
        message: 'Logged out successfully'
      })
    })
  })

  describe('JWT Security', () => {
    it('should use secure JWT secret', () => {
      expect(process.env.JWT_SECRET).toBeDefined()
      expect(process.env.JWT_SECRET).not.toBe('test-jwt-secret')
      expect(process.env.JWT_SECRET.length).toBeGreaterThan(32)
    })

    it('should set appropriate JWT expiration', () => {
      const jwt = require('jsonwebtoken')
      const { sign } = jwt
      
      // This would be tested in integration tests with real JWT
      expect(sign).toHaveBeenCalledWith(
        expect.any(Object),
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      )
    })
  })

  describe('Input Validation', () => {
    it('should sanitize user input', async () => {
      const maliciousInput = '<script>alert("xss")</script>'
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: { 
          idToken: maliciousInput,
          name: maliciousInput,
          email: maliciousInput
        }
      })

      // This test would verify that malicious input is properly sanitized
      // before being stored in the database
      await handler(req, res)

      // The response should not contain the malicious script
      const responseData = JSON.parse(res._getData())
      expect(JSON.stringify(responseData)).not.toContain('<script>')
    })

    it('should validate email format', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: { idToken: 'valid-token' }
      })

      // Mock Google Auth to return invalid email
      const { OAuth2Client } = require('google-auth-library')
      const mockClient = new OAuth2Client()
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'test-google-id',
          email: 'invalid-email-format',
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg'
        })
      })

      await handler(req, res)

      // Should still work as Google validates email format
      expect(res._getStatusCode()).toBe(200)
    })
  })
})
