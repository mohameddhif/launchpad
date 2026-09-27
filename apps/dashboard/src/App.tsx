import { Routes, Route } from "react-router-dom";
import { Layout, RequireAuth } from "./components/Layout.js";
import { Login } from "./routes/Login.js";
import { ProjectList } from "./routes/ProjectList.js";
import { ProjectDetail } from "./routes/ProjectDetail.js";
import { DeploymentDetail } from "./routes/DeploymentDetail.js";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/deployments/:id" element={<DeploymentDetail />} />
        </Route>
      </Route>
    </Routes>
  );
}
