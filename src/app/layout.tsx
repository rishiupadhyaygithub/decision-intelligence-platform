import type { Metadata } from 'next'
import { Schibsted_Grotesk } from 'next/font/google'
import './globals.css'

// One family throughout; figures use tabular numerals (see globals.css).
const grotesk = Schibsted_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' })

export const metadata: Metadata = {
  title: 'DecisionOS',
  description: 'Decisions grounded in your own numbers. Every figure links to the data behind it.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body>{children}</body>
    </html>
  )
}
