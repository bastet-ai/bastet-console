import { AppProps } from 'next/app'
import Head from 'next/head'
import '../src/styles/index.css'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <script src="https://apis.google.com/js/api.js" async defer></script>
        <script src="https://accounts.google.com/gsi/client" async defer></script>
      </Head>
      <Component {...pageProps} />
    </>
  )
}
