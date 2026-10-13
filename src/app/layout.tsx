import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import { DemoRuntime } from "@/components/demo-runtime";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Genlixs — Turn your ideas into images and videos",
    template: "%s · Genlixs",
  },
  description: "Create images, edit a reference, or generate a short video in one workspace.",
  applicationName: "Genlixs",
  openGraph: {
    title: "Genlixs — Turn your ideas into images and videos",
    description: "Create images, edit a reference, or generate a short video in one workspace.",
    siteName: "Genlixs",
    type: "website",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0f1212",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <a
          href="#main"
          className="sr-only-focusable fixed top-2 left-2 z-[100] rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white"
        >
          Skip to content
        </a>
        {children}
        <DemoRuntime />
      </body>
    </html>
  );
}
