// prompt-rewriter/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Prompt 改写器",
  description: "把粗糙的图像 query，写得像专业的人在说",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning:浏览器扩展(沉浸式翻译 / Grammarly / 暗色主题等)
  // 在 React hydrate 前往 <html> / <body> 加 data-* 属性,会触发 hydration mismatch。
  // 这些是无害的副作用(扩展加的属性不影响应用功能),用 suppressHydrationWarning 静音即可。
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className="min-h-screen bg-parchment text-near-black antialiased"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
