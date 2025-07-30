import "./globals.css";
import { ThemeProvider } from "./providers/theme-provider";
import { Providers } from "./providers";
import { Metadata } from "next";
import { HelpModalProvider } from "./providers/help-modal-provider";
import { Auth0Provider } from "@auth0/nextjs-auth0";

// Font is loaded via CSS import in globals.css

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
        <body className="h-full text-base [scrollbar-width:thin] bg-background">
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
