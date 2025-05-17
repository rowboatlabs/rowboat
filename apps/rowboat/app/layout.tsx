import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";
import { UserProvider } from '@auth0/nextjs-auth0/client';
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Metadata } from "next";
import { HelpModalProvider } from "./providers/help-modal-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "RowBoat labs",
    template: "%s | RowBoat Labs",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <html lang="en" className="h-dvh">
    <UserProvider>
      <ThemeProvider>
        <head>
          <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
        </head>
        <body className={`${inter.className} h-full text-base [scrollbar-width:thin] bg-background`}>
          <Providers className='h-full flex flex-col'>
            <HelpModalProvider>
              {children}
            </HelpModalProvider>
          </Providers>
        </body>
      </ThemeProvider>
    </UserProvider>
  </html>;
}
