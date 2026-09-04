import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#C43B6F" />
        <meta name="application-name" content="SavignaLearn" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SavignaLearn" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="description"
          content="Bilingual learning chat — send in your language, read line-by-line in theirs."
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.png" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="preload" href="/fonts/ionicons.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link
          rel="preload"
          href="/fonts/FontAwesome.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
@font-face {
  font-family: ionicons;
  src: url("/fonts/ionicons.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: FontAwesome;
  src: url("/fonts/FontAwesome.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
body {
  background-color: #FFF5F8;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #1A0810;
  }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}`;
