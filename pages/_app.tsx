import { AppProps } from 'next/app'
import Head from 'next/head'
import Script from 'next/script'
import '../src/styles/index.css'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Bastet Console</title>
        <meta name="description" content="Operational command for your Bastet nodes" />
        <link rel="icon" href="/favicon.svg" />
      </Head>
      
      {/* Google Identity Services - Custom OAuth (NOT Supabase Auth) */}
      <Script 
        src="https://apis.google.com/js/api.js" 
        strategy="afterInteractive"
      />
      <Script 
        src="https://accounts.google.com/gsi/client" 
        strategy="afterInteractive"
      />
      
      <Component {...pageProps} />
    </>
  )
}
