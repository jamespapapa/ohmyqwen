import "./globals.css";

export const metadata = {
  title: "ohmyqwen Runtime Console",
  description: "Next.js console for local agentic runtime"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
