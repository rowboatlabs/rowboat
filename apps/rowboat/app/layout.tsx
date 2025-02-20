import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";
import { UserProvider } from '@auth0/nextjs-auth0/client';
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Metadata } from "next";

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
        <body className={`${inter.className} h-full text-base [scrollbar-width:thin] bg-background`}>
          <Providers className='h-full flex flex-col'>
            {children}
          </Providers>
        </body>
      </ThemeProvider>
    </UserProvider>
  </html>;
}
