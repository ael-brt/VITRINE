import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { BaseLayout } from "./layouts/BaseLayout";
import { isAuthenticated, validateSession } from "./auth";
import { Home } from "./pages/Home";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Showcase } from "./pages/Showcase";
import { Quiz } from "./pages/Expertise";
import { Contact } from "./pages/Contact";
import { Process } from "./pages/Process";
import { Map } from "./pages/Map";
import { Login } from "./pages/Login";
import { Welcome } from "./pages/Welcome";
import { DashboardFloatingCarData } from "./pages/DashboardFloatingCarData";
import { DashboardSecteurScolaire } from "./pages/DashboardSecteurScolaire";
import { DashboardCeremap3D } from "./pages/DashboardCeremap3D";
import { ContextDefinitions } from "./pages/ContextDefinitions";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const [isValidating, setIsValidating] = useState(true);
  const [isValidSession, setIsValidSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function validate() {
      if (!isAuthenticated()) {
        if (!cancelled) {
          setIsValidSession(false);
          setIsValidating(false);
        }
        return;
      }

      const ok = await validateSession();
      if (!cancelled) {
        setIsValidSession(ok);
        setIsValidating(false);
      }
    }

    void validate();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isValidating) {
    return null;
  }

  if (!isValidSession) {
    return <Navigate to="/connexion" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <BaseLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/connexion" element={<Login />} />
        <Route path="/welcome" element={<Navigate to="/dashboardhome" replace />} />
        <Route
          path="/dashboardhome"
          element={
            <ProtectedRoute>
              <Welcome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboards/floatingcardata"
          element={
            <ProtectedRoute>
              <DashboardFloatingCarData />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboards/secteurscolaire"
          element={
            <ProtectedRoute>
              <DashboardSecteurScolaire />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboards/ceremap3d"
          element={
            <ProtectedRoute>
              <DashboardCeremap3D />
            </ProtectedRoute>
          }
        />
        <Route path="/projets" element={<Projects />} />
        <Route path="/projets/:slug" element={<ProjectDetail />} />
        <Route path="/showcase" element={<Showcase />} />
        <Route path="/contextes" element={<ContextDefinitions />} />
        <Route path="/carte" element={<Map />} />
        <Route path="/process" element={<Process />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BaseLayout>
  );
}

export default App;
