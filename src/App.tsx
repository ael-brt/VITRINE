import { Routes, Route } from "react-router-dom";
import { BaseLayout } from "./layouts/BaseLayout";
import { Home } from "./pages/Home";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Showcase } from "./pages/Showcase";
import { Quiz } from "./pages/Expertise";
import { Contact } from "./pages/Contact";

function App() {
  return (
    <BaseLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projets" element={<Projects />} />
        <Route path="/projets/:slug" element={<ProjectDetail />} />
        <Route path="/showcase" element={<Showcase />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/contact" element={<Contact />} />
      </Routes>
    </BaseLayout>
  );
}

export default App;
