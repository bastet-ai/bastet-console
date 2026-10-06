import { useState, useEffect } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Navbar from '../src/components/Navbar'
import { HeroSection } from '../src/sections/HeroSection'
import { FeaturesSection } from '../src/sections/FeaturesSection'
import { WorkflowSection } from '../src/sections/WorkflowSection'
import { AdministrationSection } from '../src/sections/AdministrationSection'
import { Footer } from '../src/components/Footer'
import { signInWithGoogle, signOut, verifySession, isLocalDebug, type User } from '../src/lib/authClient'

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [debug, setDebug] = useState(false)
  useEffect(() => { void isLocalDebug().then(setDebug) }, [])

  useEffect(() => {
    // Check for existing session
    const checkAuth = async () => {
      try {
        const { user, error } = await verifySession()
        if (user) {
          setUser(user)
          // Redirect logged-in users to dashboard
          router.push('/dashboard')
          return
        }
      } catch (error) {
        console.error('Auth check failed:', error)
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [router])

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true)
      const { user, error } = await signInWithGoogle()
      if (user) {
        setUser(user)
        // Redirect to dashboard after successful login
        router.push('/dashboard')
      } else if (error) {
        console.error('Sign in failed:', error)
        alert('Sign in failed: ' + error)
      }
    } catch (error) {
      console.error('Sign in failed:', error)
      alert('Sign in failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      setLoading(true)
      await signOut()
      setUser(null)
    } catch (error) {
      console.error('Sign out failed:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Bastet Console - Vulnerability Management Platform</title>
        <meta name="description" content="Comprehensive vulnerability management and security scanning platform" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar
          signInLabel={debug ? 'Sign in as local admin' : undefined}
          user={user}
          onSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
        />

        <main>
          <HeroSection user={user} onSignIn={handleGoogleSignIn} signInLabel={debug ? 'Sign in as local admin' : undefined} />
          <FeaturesSection />
          <WorkflowSection />
          <AdministrationSection user={user} />
        </main>

        <Footer />
      </div>
    </>
  )
}
