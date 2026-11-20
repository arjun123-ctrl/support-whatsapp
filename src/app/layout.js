import "./globals.css";

export const metadata = {
  title: { default: "ARKNP | Smart NFC Solutions", template: "%s | ARKNP" },
  description: "ARKNP smart NFC solutions and customer support.",
  icons: { icon: "/arknp.png" },
};
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
