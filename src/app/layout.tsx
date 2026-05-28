import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Free Image to 3D Studio",
  description: "Open-source image-to-GLB generator UI powered by Stable Fast 3D or mock mode."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
