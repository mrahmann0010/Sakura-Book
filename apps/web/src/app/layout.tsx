import type { Metadata } from "next";
import { Lora, Public_Sans } from "next/font/google";
import "./globals.css";

/* Lora for titles and book names, italic for authors. */
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

/* Public Sans for all interface text. */
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marginalia",
  description:
    "A small catalog of books, chosen by hand and posted from Bristol.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lora.variable} ${publicSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
