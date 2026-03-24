import { Header } from "../components/Header/Header";
import { Footer } from "../components/Footer/Footer";
import "../styles/global.css";

export function BaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
