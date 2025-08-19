import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Metadata } from "next";
import { HelpModalProvider } from "./providers/help-modal-provider";
import { Auth0Provider } from "@auth0/nextjs-auth0";

const inter = Inter({ 
  subsets: ["latin"],
  display: 'swap',
  fallback: ['system-ui', 'arial']
});

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
    <Auth0Provider>
      <ThemeProvider>
        <body className={`${inter.className} h-full text-base [scrollbar-width:thin] bg-background`}>
          <Providers className='h-full flex flex-col'>
            <HelpModalProvider>
              {children}
            </HelpModalProvider>
          </Providers>
        </body>
      </ThemeProvider>
    </Auth0Provider>
  </html>;
}
