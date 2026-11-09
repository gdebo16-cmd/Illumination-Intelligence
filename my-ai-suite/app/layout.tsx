import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ChatProvider } from "@/app/ChatContext";

export const metadata: Metadata = {
  title: "Lumen", description: "Illumination Intelligence", appleWebApp: { capable: true, statusBarStyle: "black-translucent" },
};

export default function RootLayout({ 
  children, }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <ChatProvider>{children}</ChatProvider>
        </body>
    </html>
  );
}

export const viewport: Viewport = {
  themeColor: "#080c14", // Match your dark background/banner color
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};


