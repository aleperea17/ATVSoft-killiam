import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { ThemeProvider } from '@/shared/components/theme-provider'
import { ToastProvider } from '@/shared/components/toast'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ATV Soft',
  description: 'Plataforma integral de gestion de contenido y ventas para creadores high-ticket',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const themeScript = `(function(){try{var t=localStorage.getItem('atv-theme')||localStorage.getItem('atvmkt-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');else document.documentElement.removeAttribute('data-theme');}catch(e){}})();`

  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <body>
        <Script id="atv-theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
